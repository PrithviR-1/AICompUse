//! Tauri command handlers. Each is a thin adapter over `machi-core`; errors cross the
//! boundary as `ErrorInfo` (kind + plain-language message), never as panics.

use std::path::PathBuf;

use machi_core::app::{Bootstrap, MachiCore, ProviderStatus};
use machi_core::chat::{
    ChatEvent, ChatSink, EditRequest, RegenerateRequest, SendRequest, SendResult,
};
use machi_core::directory::ModelList;
use machi_core::error::ErrorInfo;
use machi_core::export::ExportFormat;
use machi_core::providers::ProviderId;
use machi_core::types::{
    AppSettings, ChatSettings, Conversation, ConversationDetail, ConversationSummary, SearchHit,
};
use machi_platform::PlatformInfo;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

type CmdResult<T> = Result<T, ErrorInfo>;

/// Forwards chat events to the front end over a per-call channel.
struct ChannelSink(Channel<ChatEvent>);

impl ChatSink for ChannelSink {
    fn send(&self, event: ChatEvent) {
        if let Err(err) = self.0.send(event) {
            tracing::debug!(error = %err, "chat event channel closed");
        }
    }
}

fn sink(channel: Channel<ChatEvent>) -> std::sync::Arc<dyn ChatSink> {
    std::sync::Arc::new(ChannelSink(channel))
}

fn err(e: impl Into<ErrorInfo>) -> ErrorInfo {
    e.into()
}

fn export_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| std::env::temp_dir())
}

/// Facts about the host OS that the UI needs (shortcut labels).
#[tauri::command]
#[specta::specta]
pub fn platform_info() -> PlatformInfo {
    machi_platform::current().info()
}

#[tauri::command]
#[specta::specta]
pub fn bootstrap(core: State<'_, MachiCore>) -> CmdResult<Bootstrap> {
    let boot = core.bootstrap().map_err(err)?;
    tracing::info!(has_required_key = boot.has_required_key, "ui connected");
    Ok(boot)
}

#[tauri::command]
#[specta::specta]
pub async fn list_models(core: State<'_, MachiCore>, refresh: bool) -> CmdResult<ModelList> {
    Ok(core.list_models(refresh).await)
}

#[tauri::command]
#[specta::specta]
pub fn provider_statuses(core: State<'_, MachiCore>) -> Vec<ProviderStatus> {
    core.provider_statuses()
}

#[tauri::command]
#[specta::specta]
pub async fn test_api_key(
    core: State<'_, MachiCore>,
    provider: ProviderId,
    key: Option<String>,
) -> CmdResult<()> {
    core.test_key(provider, key).await.map_err(err)
}

#[tauri::command]
#[specta::specta]
pub async fn save_api_key(
    core: State<'_, MachiCore>,
    provider: ProviderId,
    key: String,
) -> CmdResult<ProviderStatus> {
    core.save_key(provider, key).await.map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn delete_api_key(
    core: State<'_, MachiCore>,
    provider: ProviderId,
) -> CmdResult<ProviderStatus> {
    core.delete_key(provider).map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn save_settings(core: State<'_, MachiCore>, settings: AppSettings) -> CmdResult<AppSettings> {
    core.save_settings(settings).map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn list_conversations(core: State<'_, MachiCore>) -> CmdResult<Vec<ConversationSummary>> {
    core.list_conversations().map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn get_conversation(core: State<'_, MachiCore>, id: String) -> CmdResult<ConversationDetail> {
    core.get_conversation(&id).map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn search_conversations(
    core: State<'_, MachiCore>,
    query: String,
) -> CmdResult<Vec<SearchHit>> {
    core.search(&query).map_err(err)
}

#[tauri::command]
#[specta::specta]
pub async fn send_message(
    core: State<'_, MachiCore>,
    request: SendRequest,
    on_event: Channel<ChatEvent>,
) -> CmdResult<SendResult> {
    core.chat.send(request, sink(on_event)).map_err(err)
}

#[tauri::command]
#[specta::specta]
pub async fn regenerate_message(
    core: State<'_, MachiCore>,
    request: RegenerateRequest,
    on_event: Channel<ChatEvent>,
) -> CmdResult<SendResult> {
    core.chat.regenerate(request, sink(on_event)).map_err(err)
}

#[tauri::command]
#[specta::specta]
pub async fn edit_message(
    core: State<'_, MachiCore>,
    request: EditRequest,
    on_event: Channel<ChatEvent>,
) -> CmdResult<SendResult> {
    core.chat.edit(request, sink(on_event)).map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn stop_generation(core: State<'_, MachiCore>, message_id: String) -> bool {
    core.chat.stop(&message_id)
}

#[tauri::command]
#[specta::specta]
pub fn stop_conversation(core: State<'_, MachiCore>, conversation_id: String) -> u32 {
    u32::try_from(core.chat.stop_conversation(&conversation_id)).unwrap_or(u32::MAX)
}

#[tauri::command]
#[specta::specta]
pub fn select_branch(
    core: State<'_, MachiCore>,
    conversation_id: String,
    message_id: String,
) -> CmdResult<Conversation> {
    core.chat
        .select_branch(&conversation_id, &message_id)
        .map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn delete_message(core: State<'_, MachiCore>, message_id: String) -> CmdResult<Conversation> {
    core.chat.delete_message(&message_id).map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn start_compare(
    core: State<'_, MachiCore>,
    conversation_id: String,
    models: Vec<String>,
) -> CmdResult<Conversation> {
    core.chat
        .start_compare(&conversation_id, &models)
        .map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn set_compare_model(
    core: State<'_, MachiCore>,
    conversation_id: String,
    column: u32,
    model_key: String,
) -> CmdResult<Conversation> {
    core.chat
        .set_compare_model(&conversation_id, column as usize, &model_key)
        .map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn end_compare(
    core: State<'_, MachiCore>,
    conversation_id: String,
    keep_column: Option<u32>,
) -> CmdResult<Conversation> {
    core.chat
        .end_compare(&conversation_id, keep_column.map(|c| c as usize))
        .map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn rename_conversation(
    core: State<'_, MachiCore>,
    id: String,
    title: String,
) -> CmdResult<Conversation> {
    core.chat.rename(&id, &title).map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn set_conversation_pinned(
    core: State<'_, MachiCore>,
    id: String,
    pinned: bool,
) -> CmdResult<Conversation> {
    core.chat.set_pinned(&id, pinned).map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn update_chat_settings(
    core: State<'_, MachiCore>,
    id: String,
    settings: ChatSettings,
) -> CmdResult<Conversation> {
    core.chat.update_settings(&id, settings).map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn delete_conversation(core: State<'_, MachiCore>, id: String) -> CmdResult<()> {
    core.chat.delete_conversation(&id).map_err(err)
}

/// Writes the export into the Downloads folder and returns the file path.
#[tauri::command]
#[specta::specta]
pub fn export_conversation(
    app: AppHandle,
    core: State<'_, MachiCore>,
    id: String,
    format: ExportFormat,
) -> CmdResult<String> {
    core.export_conversation(&id, format, &export_dir(&app))
        .map(|p| p.display().to_string())
        .map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn export_all(
    app: AppHandle,
    core: State<'_, MachiCore>,
    format: ExportFormat,
) -> CmdResult<String> {
    core.export_all(format, &export_dir(&app))
        .map(|p| p.display().to_string())
        .map_err(err)
}

#[tauri::command]
#[specta::specta]
pub fn delete_all_data(core: State<'_, MachiCore>) -> CmdResult<()> {
    core.delete_all_data().map_err(err)
}
