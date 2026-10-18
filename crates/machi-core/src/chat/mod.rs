//! Chat orchestration: sending, streaming into the store, stopping, branching
//! (edit/regenerate), compare mode and title generation (§11.5–§11.7).
//!
//! Every generation runs in its own task and reports to a [`ChatSink`] (a Tauri channel
//! in the app, a recorder in tests). Message trees are persisted as they change, so a
//! crash loses at most the last second of a streaming reply.

pub mod context;
mod title;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use specta::Type;
use tokio_util::sync::CancellationToken;

use crate::directory::ModelDirectory;
use crate::error::{CoreError, CoreResult, ErrorInfo};
use crate::models::{ModelInfo, parse_model_key};
use crate::providers::types::{ChatRequest, StreamEvent};
use crate::providers::{ProviderError, ProviderFactory};
use crate::store::{MessageCompletion, Store, TelemetryRecord};
use crate::types::{
    Attachment, AttachmentKind, ChatSettings, CompareColumn, Conversation, Message, MessageStatus,
    NewAttachment, Role, TitleSource, new_id, now_ms,
};
use context::{Tree, build_messages};

/// Compare mode shows 2–3 columns (§11.7).
pub const MAX_COMPARE_COLUMNS: usize = 3;
const MAX_ATTACHMENT_BYTES: u32 = 20 * 1024 * 1024;
const PERSIST_EVERY: Duration = Duration::from_millis(1000);

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeltaEvent {
    pub conversation_id: String,
    pub message_id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FinishedEvent {
    pub message: Message,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TitleEvent {
    pub conversation_id: String,
    pub title: String,
}

/// Streamed to the UI while generations run.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    Delta(DeltaEvent),
    Finished(FinishedEvent),
    Title(TitleEvent),
}

pub trait ChatSink: Send + Sync + 'static {
    fn send(&self, event: ChatEvent);
}

#[derive(Debug, Clone, PartialEq, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SendRequest {
    /// `None` starts a new conversation.
    pub conversation_id: Option<String>,
    pub content: String,
    pub attachments: Vec<NewAttachment>,
    /// Model for this message (single mode). Ignored when compare mode is active.
    pub model_key: String,
    /// Starts compare mode with these models (new conversations only).
    pub compare_models: Option<Vec<String>>,
    /// Settings for a new conversation (the composer's draft settings).
    pub settings: Option<ChatSettings>,
    /// New conversations only: don't keep in history.
    pub temporary: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub conversation: Conversation,
    /// Messages created by this call (user messages, then streaming assistant replies).
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RegenerateRequest {
    /// The assistant message to regenerate.
    pub message_id: String,
    /// Another model ("Retry with…"); defaults to the original message's model.
    pub model_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EditRequest {
    /// The user message to edit; the edit becomes a sibling branch.
    pub message_id: String,
    pub content: String,
    pub model_key: String,
}

struct ActiveGeneration {
    conversation_id: String,
    cancel: CancellationToken,
}

pub struct ChatService {
    store: Arc<Store>,
    directory: Arc<ModelDirectory>,
    factory: Arc<dyn ProviderFactory>,
    active: Mutex<HashMap<String, ActiveGeneration>>,
    flush_interval: Duration,
}

impl ChatService {
    pub fn new(
        store: Arc<Store>,
        directory: Arc<ModelDirectory>,
        factory: Arc<dyn ProviderFactory>,
    ) -> Arc<Self> {
        Arc::new(Self {
            store,
            directory,
            factory,
            active: Mutex::new(HashMap::new()),
            flush_interval: Duration::from_millis(40),
        })
    }

    #[cfg(test)]
    fn with_flush_interval(
        store: Arc<Store>,
        directory: Arc<ModelDirectory>,
        factory: Arc<dyn ProviderFactory>,
        flush: Duration,
    ) -> Arc<Self> {
        Arc::new(Self {
            store,
            directory,
            factory,
            active: Mutex::new(HashMap::new()),
            flush_interval: flush,
        })
    }

    /// Startup housekeeping: interrupted replies become "stopped", temporary chats go.
    pub fn recover(&self) -> CoreResult<()> {
        self.store.mark_streaming_as_stopped()?;
        self.store.delete_temporary_conversations()?;
        Ok(())
    }

    /// A model that can be used for a chat reply, or a plain-language reason it can't.
    fn model(&self, key: &str) -> CoreResult<ModelInfo> {
        let model = self
            .directory
            .find(key)
            .ok_or_else(|| CoreError::Invalid(format!("Unknown model `{key}`.")))?;
        if !model.chat_supported {
            let reason = model
                .unavailable_reason
                .clone()
                .unwrap_or_else(|| "This model can't be used for chat yet.".into());
            return Err(CoreError::Invalid(format!("{}: {reason}", model.name)));
        }
        Ok(model)
    }

    fn conversation(&self, id: &str) -> CoreResult<Conversation> {
        self.store
            .get_conversation(id)?
            .ok_or(CoreError::NotFound("chat"))
    }

    // ---- sending -------------------------------------------------------------------

    pub fn send(
        self: &Arc<Self>,
        request: SendRequest,
        sink: Arc<dyn ChatSink>,
    ) -> CoreResult<SendResult> {
        let content = request.content.trim_end().to_string();
        if content.trim().is_empty() && request.attachments.is_empty() {
            return Err(CoreError::Invalid(
                "Type a message or attach a file first.".into(),
            ));
        }
        validate_new_attachments(&request.attachments)?;
        let now = now_ms();

        let mut conversation = match &request.conversation_id {
            Some(id) => self.conversation(id)?,
            None => self.create_conversation(&request, &content, now)?,
        };

        // (model, parent) pairs to answer: one per compare column, or just one.
        let targets: Vec<(String, Option<String>)> = match &conversation.compare {
            Some(columns) => columns
                .iter()
                .map(|c| (c.model_key.clone(), c.leaf_id.clone()))
                .collect(),
            None => vec![(
                request.model_key.clone(),
                conversation.current_leaf_id.clone(),
            )],
        };
        let models = targets
            .iter()
            .map(|(key, _)| self.model(key))
            .collect::<CoreResult<Vec<_>>>()?;
        for model in &models {
            check_attachments_supported(&request.attachments, model)?;
        }

        // One user message per distinct parent; compare columns sharing a parent share it.
        let mut created = Vec::new();
        let mut user_for_parent: HashMap<Option<String>, String> = HashMap::new();
        let mut new_leaves = Vec::new();
        for ((model_key, parent), _model) in targets.iter().zip(&models) {
            let user_id = match user_for_parent.get(parent) {
                Some(id) => id.clone(),
                None => {
                    let user = user_message(
                        &conversation.id,
                        parent.clone(),
                        &content,
                        &request.attachments,
                        now,
                    );
                    self.store.insert_message(&user)?;
                    user_for_parent.insert(parent.clone(), user.id.clone());
                    let id = user.id.clone();
                    created.push(user);
                    id
                }
            };
            let assistant = assistant_message(&conversation.id, &user_id, model_key, now + 1);
            self.store.insert_message(&assistant)?;
            new_leaves.push(assistant.id.clone());
            created.push(assistant);
        }

        if let Some(columns) = conversation.compare.as_mut() {
            for (column, leaf) in columns.iter_mut().zip(&new_leaves) {
                column.leaf_id = Some(leaf.clone());
            }
        }
        conversation.current_leaf_id = new_leaves.first().cloned();
        conversation.updated_at = now;
        self.store.update_conversation(&conversation)?;
        self.note_recent_models(targets.iter().map(|(k, _)| k.as_str()));

        for message in created.iter().filter(|m| m.role == Role::Assistant) {
            self.spawn_generation(message.clone(), sink.clone());
        }
        Ok(SendResult {
            conversation,
            messages: created,
        })
    }

    fn create_conversation(
        &self,
        request: &SendRequest,
        content: &str,
        now: i64,
    ) -> CoreResult<Conversation> {
        let compare = match &request.compare_models {
            Some(models) if models.len() >= 2 => Some(compare_columns(models, None)?),
            Some(_) => {
                return Err(CoreError::Invalid(
                    "Compare needs at least two models.".into(),
                ));
            }
            None => None,
        };
        let conversation = Conversation {
            id: new_id(),
            title: title::provisional(content, &request.attachments),
            title_source: TitleSource::Auto,
            pinned: false,
            temporary: request.temporary,
            current_leaf_id: None,
            compare,
            settings: request.settings.clone().unwrap_or_default().sanitized(),
            created_at: now,
            updated_at: now,
        };
        self.store.insert_conversation(&conversation)?;
        Ok(conversation)
    }

    fn note_recent_models<'a>(&self, keys: impl Iterator<Item = &'a str>) {
        if let Ok(mut settings) = self.store.load_app_settings() {
            let keys: Vec<_> = keys.collect();
            for key in keys.iter().rev() {
                settings.note_recent(key);
            }
            if let Err(err) = self.store.save_app_settings(&settings) {
                tracing::warn!(error = %err, "could not save recent models");
            }
        }
    }

    pub fn regenerate(
        self: &Arc<Self>,
        request: RegenerateRequest,
        sink: Arc<dyn ChatSink>,
    ) -> CoreResult<SendResult> {
        let old = self
            .store
            .get_message(&request.message_id)?
            .ok_or(CoreError::NotFound("message"))?;
        if old.role != Role::Assistant {
            return Err(CoreError::Invalid(
                "Only replies can be regenerated.".into(),
            ));
        }
        let parent_id = old
            .parent_id
            .clone()
            .ok_or_else(|| CoreError::Invalid("This reply has no prompt.".into()))?;
        let parent = self
            .store
            .get_message(&parent_id)?
            .ok_or(CoreError::NotFound("message"))?;
        let model_key = request
            .model_key
            .or_else(|| old.model_key.clone())
            .ok_or_else(|| CoreError::Invalid("Choose a model to retry with.".into()))?;
        let model = self.model(&model_key)?;
        check_stored_attachments_supported(&parent.attachments, &model)?;

        let mut conversation = self.conversation(&old.conversation_id)?;
        let assistant = assistant_message(&conversation.id, &parent_id, &model_key, now_ms());
        self.store.insert_message(&assistant)?;
        let mut moved_column = false;
        if let Some(columns) = conversation.compare.as_mut() {
            for column in columns
                .iter_mut()
                .filter(|c| c.leaf_id.as_deref() == Some(old.id.as_str()))
            {
                column.leaf_id = Some(assistant.id.clone());
                column.model_key = model_key.clone();
                moved_column = true;
            }
        }
        if !moved_column || conversation.current_leaf_id.as_deref() == Some(old.id.as_str()) {
            conversation.current_leaf_id = Some(assistant.id.clone());
        }
        conversation.updated_at = now_ms();
        self.store.update_conversation(&conversation)?;
        self.note_recent_models(std::iter::once(model_key.as_str()));
        self.spawn_generation(assistant.clone(), sink);
        Ok(SendResult {
            conversation,
            messages: vec![assistant],
        })
    }

    pub fn edit(
        self: &Arc<Self>,
        request: EditRequest,
        sink: Arc<dyn ChatSink>,
    ) -> CoreResult<SendResult> {
        let original = self
            .store
            .get_message(&request.message_id)?
            .ok_or(CoreError::NotFound("message"))?;
        if original.role != Role::User {
            return Err(CoreError::Invalid(
                "Only your own messages can be edited.".into(),
            ));
        }
        let mut conversation = self.conversation(&original.conversation_id)?;
        if conversation.compare.is_some() {
            return Err(CoreError::Invalid(
                "Leave compare mode to edit a message.".into(),
            ));
        }
        let content = request.content.trim_end().to_string();
        if content.trim().is_empty() && original.attachments.is_empty() {
            return Err(CoreError::Invalid("The edited message is empty.".into()));
        }
        let model = self.model(&request.model_key)?;
        check_stored_attachments_supported(&original.attachments, &model)?;

        let now = now_ms();
        let attachments = original
            .attachments
            .iter()
            .map(|a| Attachment {
                id: new_id(),
                ..a.clone()
            })
            .collect();
        let user = Message {
            id: new_id(),
            content,
            attachments,
            created_at: now,
            ..original.clone()
        };
        self.store.insert_message(&user)?;
        let assistant = assistant_message(&conversation.id, &user.id, &request.model_key, now + 1);
        self.store.insert_message(&assistant)?;
        conversation.current_leaf_id = Some(assistant.id.clone());
        conversation.updated_at = now;
        self.store.update_conversation(&conversation)?;
        self.note_recent_models(std::iter::once(request.model_key.as_str()));
        self.spawn_generation(assistant.clone(), sink);
        Ok(SendResult {
            conversation,
            messages: vec![user, assistant],
        })
    }

    // ---- stopping ------------------------------------------------------------------

    /// Stops one streaming reply. Returns false if it was not streaming.
    pub fn stop(&self, message_id: &str) -> bool {
        match self.active.lock() {
            Ok(active) => active.get(message_id).map(|g| g.cancel.cancel()).is_some(),
            Err(_) => false,
        }
    }

    /// Stops every streaming reply of a conversation (compare columns included).
    pub fn stop_conversation(&self, conversation_id: &str) -> usize {
        match self.active.lock() {
            Ok(active) => active
                .values()
                .filter(|g| g.conversation_id == conversation_id)
                .map(|g| g.cancel.cancel())
                .count(),
            Err(_) => 0,
        }
    }

    pub fn is_streaming(&self, message_id: &str) -> bool {
        self.active
            .lock()
            .map(|a| a.contains_key(message_id))
            .unwrap_or(false)
    }

    // ---- tree and conversation edits -----------------------------------------------

    /// Shows the branch through `message_id` (branch navigation ‹ 2/3 ›).
    pub fn select_branch(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> CoreResult<Conversation> {
        let messages = self.store.list_messages(conversation_id)?;
        let tree = Tree::new(&messages);
        if tree.get(message_id).is_none() {
            return Err(CoreError::NotFound("message"));
        }
        let mut conversation = self.conversation(conversation_id)?;
        conversation.current_leaf_id = Some(tree.latest_leaf(message_id));
        self.store.update_conversation(&conversation)?;
        Ok(conversation)
    }

    /// Deletes a message and its replies; the visible branch moves to its parent.
    pub fn delete_message(&self, message_id: &str) -> CoreResult<Conversation> {
        let message = self
            .store
            .get_message(message_id)?
            .ok_or(CoreError::NotFound("message"))?;
        let messages = self.store.list_messages(&message.conversation_id)?;
        let tree = Tree::new(&messages);
        let removed = tree.subtree(message_id);
        for id in &removed {
            self.stop(id);
        }
        self.store.delete_message(message_id)?;

        let mut conversation = self.conversation(&message.conversation_id)?;
        let is_removed = |id: &Option<String>| id.as_ref().is_some_and(|id| removed.contains(id));
        if is_removed(&conversation.current_leaf_id) {
            conversation.current_leaf_id = message.parent_id.clone();
        }
        if let Some(columns) = conversation.compare.as_mut() {
            for column in columns.iter_mut().filter(|c| is_removed(&c.leaf_id)) {
                column.leaf_id = message.parent_id.clone();
            }
        }
        conversation.updated_at = now_ms();
        self.store.update_conversation(&conversation)?;
        Ok(conversation)
    }

    /// Turns compare mode on for an existing chat; every column starts at the current leaf.
    pub fn start_compare(
        &self,
        conversation_id: &str,
        models: &[String],
    ) -> CoreResult<Conversation> {
        let mut conversation = self.conversation(conversation_id)?;
        conversation.compare = Some(compare_columns(
            models,
            conversation.current_leaf_id.clone(),
        )?);
        self.store.update_conversation(&conversation)?;
        Ok(conversation)
    }

    /// Changes the model of one compare column (applies to its next reply).
    pub fn set_compare_model(
        &self,
        conversation_id: &str,
        column: usize,
        model_key: &str,
    ) -> CoreResult<Conversation> {
        self.model(model_key)?;
        let mut conversation = self.conversation(conversation_id)?;
        let columns = conversation
            .compare
            .as_mut()
            .ok_or_else(|| CoreError::Invalid("Compare mode is off.".into()))?;
        let slot = columns
            .get_mut(column)
            .ok_or_else(|| CoreError::Invalid("No such compare column.".into()))?;
        slot.model_key = model_key.to_string();
        self.store.update_conversation(&conversation)?;
        Ok(conversation)
    }

    /// Leaves compare mode, continuing with the branch of `keep_column` ("Continue with
    /// this one"), or the first column when none is chosen.
    pub fn end_compare(
        &self,
        conversation_id: &str,
        keep_column: Option<usize>,
    ) -> CoreResult<Conversation> {
        let mut conversation = self.conversation(conversation_id)?;
        if let Some(columns) = conversation.compare.take() {
            let index = keep_column.unwrap_or(0);
            let chosen = columns
                .get(index)
                .ok_or_else(|| CoreError::Invalid("No such compare column.".into()))?;
            if chosen.leaf_id.is_some() {
                conversation.current_leaf_id = chosen.leaf_id.clone();
            }
        }
        self.store.update_conversation(&conversation)?;
        Ok(conversation)
    }

    pub fn rename(&self, conversation_id: &str, title: &str) -> CoreResult<Conversation> {
        let title = title.trim();
        if title.is_empty() {
            return Err(CoreError::Invalid("A chat title can't be empty.".into()));
        }
        let mut conversation = self.conversation(conversation_id)?;
        conversation.title = title.chars().take(120).collect();
        conversation.title_source = TitleSource::User;
        self.store.update_conversation(&conversation)?;
        Ok(conversation)
    }

    pub fn set_pinned(&self, conversation_id: &str, pinned: bool) -> CoreResult<Conversation> {
        let mut conversation = self.conversation(conversation_id)?;
        conversation.pinned = pinned;
        self.store.update_conversation(&conversation)?;
        Ok(conversation)
    }

    pub fn update_settings(
        &self,
        conversation_id: &str,
        settings: ChatSettings,
    ) -> CoreResult<Conversation> {
        let mut conversation = self.conversation(conversation_id)?;
        conversation.settings = settings.sanitized();
        self.store.update_conversation(&conversation)?;
        Ok(conversation)
    }

    pub fn delete_conversation(&self, conversation_id: &str) -> CoreResult<()> {
        self.stop_conversation(conversation_id);
        if !self.store.delete_conversation(conversation_id)? {
            return Err(CoreError::NotFound("chat"));
        }
        Ok(())
    }

    // ---- generation ----------------------------------------------------------------

    fn spawn_generation(self: &Arc<Self>, message: Message, sink: Arc<dyn ChatSink>) {
        let cancel = CancellationToken::new();
        if let Ok(mut active) = self.active.lock() {
            active.insert(
                message.id.clone(),
                ActiveGeneration {
                    conversation_id: message.conversation_id.clone(),
                    cancel: cancel.clone(),
                },
            );
        }
        let service = Arc::clone(self);
        tokio::spawn(async move {
            let finished = service.generate(message, &cancel, sink.as_ref()).await;
            if let Ok(mut active) = service.active.lock() {
                active.remove(&finished.id);
            }
            let completed_ok = finished.status == MessageStatus::Complete;
            let conversation_id = finished.conversation_id.clone();
            sink.send(ChatEvent::Finished(FinishedEvent { message: finished }));
            if completed_ok {
                service
                    .maybe_generate_title(&conversation_id, sink.as_ref())
                    .await;
            }
        });
    }

    /// Runs one completion to the end and returns the final stored message.
    async fn generate(
        &self,
        message: Message,
        cancel: &CancellationToken,
        sink: &dyn ChatSink,
    ) -> Message {
        let started = Instant::now();
        let model_key = message.model_key.clone().unwrap_or_default();
        let mut content = String::new();
        let mut usage = None;

        let result = self
            .run_stream(&message, &model_key, cancel, sink, &mut content, &mut usage)
            .await;

        let elapsed_ms = u32::try_from(started.elapsed().as_millis()).ok();
        let model = self.directory.find(&model_key);
        let (tokens_in, tokens_out) = match usage {
            Some(u) => (Some(u.prompt_tokens), Some(u.completion_tokens)),
            None => (None, None),
        };
        let cost_usd = match (&model, tokens_in, tokens_out) {
            (Some(m), Some(i), Some(o)) => m.cost_usd(i, o),
            _ => None,
        };
        let (status, error) = match &result {
            Ok(()) => (MessageStatus::Complete, None),
            Err(CoreError::Provider(ProviderError::Cancelled)) => (MessageStatus::Stopped, None),
            Err(err) => (MessageStatus::Error, Some(ErrorInfo::from(err))),
        };
        let done = MessageCompletion {
            content: content.clone(),
            status,
            error: error.clone(),
            tokens_in,
            tokens_out,
            cost_usd,
            elapsed_ms,
        };
        if let Err(err) = self.store.complete_message(&message.id, &done) {
            tracing::error!(error = %err, "could not save finished reply");
        }
        let record = TelemetryRecord {
            at: now_ms(),
            kind: "chat",
            model_key: Some(model_key),
            tokens_in,
            tokens_out,
            cost_usd,
            ms: elapsed_ms,
            ok: status == MessageStatus::Complete,
            error_kind: error.as_ref().map(|e| format!("{:?}", e.kind)),
        };
        if let Err(err) = self.store.record_telemetry(&record) {
            tracing::warn!(error = %err, "could not record telemetry");
        }
        Message {
            content,
            status,
            error,
            tokens_in,
            tokens_out,
            cost_usd,
            elapsed_ms,
            ..message
        }
    }

    async fn run_stream(
        &self,
        message: &Message,
        model_key: &str,
        cancel: &CancellationToken,
        sink: &dyn ChatSink,
        content: &mut String,
        usage: &mut Option<crate::providers::types::Usage>,
    ) -> CoreResult<()> {
        let (provider_id, model_id) = parse_model_key(model_key)
            .ok_or_else(|| CoreError::Invalid(format!("Unknown model `{model_key}`.")))?;
        let model = self.directory.find(model_key);
        let conversation = self.conversation(&message.conversation_id)?;
        let messages = self.store.list_messages(&message.conversation_id)?;
        let tree = Tree::new(&messages);
        let parent = message
            .parent_id
            .as_deref()
            .ok_or_else(|| CoreError::Invalid("Reply has no prompt.".into()))?;
        let path = tree.path_to(parent);

        let settings = &conversation.settings;
        let mut request =
            ChatRequest::new(model_id, build_messages(&path, settings, model.as_ref()));
        request.temperature = settings.temperature;
        request.max_tokens = settings.max_tokens;
        if model.as_ref().is_some_and(|m| m.caps.reasoning) {
            request.reasoning_effort = settings.reasoning_effort;
        }

        let provider = self.factory.provider(provider_id)?;
        let mut pending = String::new();
        let mut last_flush = Instant::now();
        let mut last_persist = Instant::now();
        let flush_interval = self.flush_interval;
        let store = &self.store;
        let mut on_event = |event: StreamEvent| match event {
            StreamEvent::Delta(text) => {
                content.push_str(&text);
                pending.push_str(&text);
                if last_flush.elapsed() >= flush_interval {
                    sink.send(ChatEvent::Delta(DeltaEvent {
                        conversation_id: message.conversation_id.clone(),
                        message_id: message.id.clone(),
                        text: std::mem::take(&mut pending),
                    }));
                    last_flush = Instant::now();
                }
                if last_persist.elapsed() >= PERSIST_EVERY {
                    if let Err(err) = store.update_message_content(&message.id, content) {
                        tracing::warn!(error = %err, "could not persist partial reply");
                    }
                    last_persist = Instant::now();
                }
            }
            StreamEvent::Usage(u) => *usage = Some(u),
        };
        let result = provider.stream_chat(&request, &mut on_event, cancel).await;
        if !pending.is_empty() {
            sink.send(ChatEvent::Delta(DeltaEvent {
                conversation_id: message.conversation_id.clone(),
                message_id: message.id.clone(),
                text: pending,
            }));
        }
        result.map(|outcome| {
            if usage.is_none() {
                *usage = outcome.usage;
            }
        })?;
        Ok(())
    }

    /// After the first completed exchange, replaces the provisional title with a short
    /// one from the cheap title model. Never overwrites a user's rename.
    async fn maybe_generate_title(&self, conversation_id: &str, sink: &dyn ChatSink) {
        let Ok(Some(conversation)) = self.store.get_conversation(conversation_id) else {
            return;
        };
        let auto_title = self
            .store
            .load_app_settings()
            .map(|s| s.auto_title)
            .unwrap_or(true);
        if conversation.title_source != TitleSource::Auto || !auto_title {
            return;
        }
        let Ok(messages) = self.store.list_messages(conversation_id) else {
            return;
        };
        let Some(first_user) = messages
            .iter()
            .find(|m| m.role == Role::User && m.parent_id.is_none())
        else {
            return;
        };
        let title_model = self.directory.catalog().title_model.clone();
        let generated =
            title::generate(self.factory.as_ref(), &title_model, &first_user.content).await;
        let Some(new_title) = generated else { return };
        // Re-read: the user may have renamed the chat while the title was generating.
        let Ok(Some(mut latest)) = self.store.get_conversation(conversation_id) else {
            return;
        };
        if latest.title_source != TitleSource::Auto {
            return;
        }
        latest.title = new_title.clone();
        latest.title_source = TitleSource::Generated;
        if self.store.update_conversation(&latest).is_ok() {
            sink.send(ChatEvent::Title(TitleEvent {
                conversation_id: conversation_id.to_string(),
                title: new_title,
            }));
        }
    }
}

fn compare_columns(models: &[String], leaf: Option<String>) -> CoreResult<Vec<CompareColumn>> {
    if !(2..=MAX_COMPARE_COLUMNS).contains(&models.len()) {
        return Err(CoreError::Invalid(
            "Compare shows two or three models.".into(),
        ));
    }
    if let Some(bad) = models.iter().find(|m| parse_model_key(m).is_none()) {
        return Err(CoreError::Invalid(format!("Unknown model `{bad}`.")));
    }
    Ok(models
        .iter()
        .map(|m| CompareColumn {
            model_key: m.clone(),
            leaf_id: leaf.clone(),
        })
        .collect())
}

fn validate_new_attachments(attachments: &[NewAttachment]) -> CoreResult<()> {
    for a in attachments {
        if a.size > MAX_ATTACHMENT_BYTES
            || a.data.len() as u64 > u64::from(MAX_ATTACHMENT_BYTES) * 2
        {
            return Err(CoreError::Invalid(format!(
                "{} is larger than 20 MB.",
                a.name
            )));
        }
        if a.kind == AttachmentKind::Image && !a.data.starts_with("data:image/") {
            return Err(CoreError::Invalid(format!(
                "{} isn't a supported image.",
                a.name
            )));
        }
    }
    Ok(())
}

fn image_block_message(model: &ModelInfo) -> CoreError {
    CoreError::Invalid(format!(
        "{} can't read images. Choose a model with image support, or remove the image.",
        model.name
    ))
}

fn check_attachments_supported(attachments: &[NewAttachment], model: &ModelInfo) -> CoreResult<()> {
    if attachments.iter().any(|a| a.kind == AttachmentKind::Image) && !model.caps.vision {
        return Err(image_block_message(model));
    }
    Ok(())
}

fn check_stored_attachments_supported(
    attachments: &[Attachment],
    model: &ModelInfo,
) -> CoreResult<()> {
    if attachments.iter().any(|a| a.kind == AttachmentKind::Image) && !model.caps.vision {
        return Err(image_block_message(model));
    }
    Ok(())
}

fn user_message(
    conversation_id: &str,
    parent: Option<String>,
    content: &str,
    attachments: &[NewAttachment],
    now: i64,
) -> Message {
    Message {
        id: new_id(),
        conversation_id: conversation_id.to_string(),
        parent_id: parent,
        role: Role::User,
        content: content.to_string(),
        model_key: None,
        status: MessageStatus::Complete,
        error: None,
        tokens_in: None,
        tokens_out: None,
        cost_usd: None,
        elapsed_ms: None,
        created_at: now,
        attachments: attachments
            .iter()
            .map(|a| Attachment {
                id: new_id(),
                kind: a.kind,
                name: a.name.clone(),
                mime: a.mime.clone(),
                size: a.size,
                data: a.data.clone(),
            })
            .collect(),
    }
}

fn assistant_message(conversation_id: &str, parent: &str, model_key: &str, now: i64) -> Message {
    Message {
        id: new_id(),
        conversation_id: conversation_id.to_string(),
        parent_id: Some(parent.to_string()),
        role: Role::Assistant,
        content: String::new(),
        model_key: Some(model_key.to_string()),
        status: MessageStatus::Streaming,
        error: None,
        tokens_in: None,
        tokens_out: None,
        cost_usd: None,
        elapsed_ms: None,
        created_at: now,
        attachments: Vec::new(),
    }
}

#[cfg(test)]
mod tests;
