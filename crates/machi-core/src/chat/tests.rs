//! Chat service tests with a scripted provider: no network, deterministic streams.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::*;
use crate::error::ErrorKind;
use crate::models::Catalog;
use crate::providers::ProviderId;
use crate::providers::mock::{MockFactory, Script, ScriptedProvider};
use crate::providers::types::ContentPart;

const NANO: &str = "mixroute:gpt-4.1-nano";
const GPT41: &str = "mixroute:gpt-4.1";
const GEMINI: &str = "mixroute:gemini-2.5-flash";

#[derive(Default)]
struct RecordingSink {
    events: Mutex<Vec<ChatEvent>>,
}

impl ChatSink for RecordingSink {
    fn send(&self, event: ChatEvent) {
        self.events.lock().unwrap().push(event);
    }
}

impl RecordingSink {
    fn finished(&self) -> Vec<Message> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                ChatEvent::Finished(f) => Some(f.message.clone()),
                _ => None,
            })
            .collect()
    }

    fn deltas_for(&self, id: &str) -> String {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                ChatEvent::Delta(d) if d.message_id == id => Some(d.text.clone()),
                _ => None,
            })
            .collect()
    }

    fn titles(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                ChatEvent::Title(t) => Some(t.title.clone()),
                _ => None,
            })
            .collect()
    }

    async fn wait_finished(&self, count: usize) -> Vec<Message> {
        for _ in 0..1000 {
            let finished = self.finished();
            if finished.len() >= count {
                return finished;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("timed out waiting for {count} finished events");
    }

    async fn wait_titles(&self, count: usize) -> Vec<String> {
        for _ in 0..1000 {
            let titles = self.titles();
            if titles.len() >= count {
                return titles;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("timed out waiting for titles");
    }
}

struct Harness {
    service: Arc<ChatService>,
    provider: Arc<ScriptedProvider>,
    store: Arc<Store>,
    sink: Arc<RecordingSink>,
}

fn harness() -> Harness {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let provider = Arc::new(ScriptedProvider::new(ProviderId::Mixroute));
    let factory: Arc<dyn ProviderFactory> = Arc::new(MockFactory::default().with(provider.clone()));
    let directory = Arc::new(ModelDirectory::new(
        Arc::new(Catalog::embedded().unwrap()),
        store.clone(),
        factory.clone(),
        None,
    ));
    let service =
        ChatService::with_flush_interval(store.clone(), directory, factory, Duration::ZERO);
    let mut settings = store.load_app_settings().unwrap();
    settings.auto_title = false;
    store.save_app_settings(&settings).unwrap();
    Harness {
        service,
        provider,
        store,
        sink: Arc::new(RecordingSink::default()),
    }
}

fn send(content: &str, model: &str, conversation_id: Option<&str>) -> SendRequest {
    SendRequest {
        conversation_id: conversation_id.map(str::to_string),
        content: content.into(),
        attachments: vec![],
        model_key: model.into(),
        compare_models: None,
        settings: None,
        temporary: false,
    }
}

fn image() -> NewAttachment {
    NewAttachment {
        kind: AttachmentKind::Image,
        name: "red.png".into(),
        mime: "image/png".into(),
        size: 3,
        data: "data:image/png;base64,AAA".into(),
    }
}

#[tokio::test]
async fn send_streams_and_persists_a_complete_reply() {
    let h = harness();
    h.provider.push(Script::reply("Hello from Gemini"));
    let result = h
        .service
        .send(send("Hi there", GEMINI, None), h.sink.clone())
        .unwrap();
    assert_eq!(result.messages.len(), 2);
    let assistant = &result.messages[1];
    assert_eq!(assistant.status, MessageStatus::Streaming);
    assert_eq!(result.conversation.title, "Hi there");
    assert_eq!(
        result.conversation.current_leaf_id.as_ref(),
        Some(&assistant.id)
    );

    let finished = h.sink.wait_finished(1).await;
    assert_eq!(finished[0].status, MessageStatus::Complete);
    assert_eq!(finished[0].content, "Hello from Gemini");
    assert_eq!(h.sink.deltas_for(&assistant.id), "Hello from Gemini");
    assert_eq!(finished[0].tokens_in, Some(10));
    assert_eq!(finished[0].tokens_out, Some(5));
    let expected_cost = (10.0 * 0.30 + 5.0 * 2.50) / 1_000_000.0;
    assert!((finished[0].cost_usd.unwrap() - expected_cost).abs() < 1e-12);
    assert!(finished[0].elapsed_ms.is_some());

    let stored = h.store.get_message(&assistant.id).unwrap().unwrap();
    assert_eq!(stored.content, "Hello from Gemini");
    assert_eq!(stored.status, MessageStatus::Complete);
    assert_eq!(
        h.store.load_app_settings().unwrap().recent_models[0],
        GEMINI
    );
    assert!(!h.service.is_streaming(&assistant.id));
}

#[tokio::test]
async fn unknown_price_leaves_cost_empty() {
    let h = harness();
    // A model Mixroute might add later: no catalogue metadata, so no price.
    h.service
        .send(
            send("Hi", "mixroute:brand-new-model-x", None),
            h.sink.clone(),
        )
        .unwrap();
    let finished = h.sink.wait_finished(1).await;
    assert_eq!(finished[0].cost_usd, None);
    assert_eq!(finished[0].tokens_in, Some(10));
}

#[tokio::test]
async fn non_chat_models_are_refused_with_a_reason() {
    let h = harness();
    match h.service.send(
        send("Draw a cat", "mixroute:gemini-2.5-flash-image", None),
        h.sink.clone(),
    ) {
        Err(CoreError::Invalid(msg)) => assert!(
            msg.contains("Chat isn't supported for image models"),
            "{msg}"
        ),
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert!(
        h.provider.requests().is_empty(),
        "nothing was sent to the provider"
    );
}

#[tokio::test]
async fn stop_keeps_partial_content_and_marks_stopped() {
    let h = harness();
    h.provider.push(Script::slow(
        "one two three four five six seven eight",
        Duration::from_millis(30),
    ));
    let result = h
        .service
        .send(send("count", NANO, None), h.sink.clone())
        .unwrap();
    let assistant_id = result.messages[1].id.clone();
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert!(h.service.is_streaming(&assistant_id));
    assert!(h.service.stop(&assistant_id));
    let finished = h.sink.wait_finished(1).await;
    assert_eq!(finished[0].status, MessageStatus::Stopped);
    assert!(!finished[0].content.is_empty());
    assert!(finished[0].content.len() < "one two three four five six seven eight".len());
    assert!(!h.service.stop(&assistant_id), "already finished");
}

#[tokio::test]
async fn switching_models_mid_chat_keeps_context() {
    let h = harness();
    h.provider.push(Script::reply("The capital is Paris."));
    let first = h
        .service
        .send(send("Capital of France?", NANO, None), h.sink.clone())
        .unwrap();
    h.sink.wait_finished(1).await;
    let conversation_id = first.conversation.id.clone();
    h.provider.push(Script::reply("About 2.1 million."));
    h.service
        .send(
            send("Population?", GPT41, Some(&conversation_id)),
            h.sink.clone(),
        )
        .unwrap();
    let finished = h.sink.wait_finished(2).await;
    assert_eq!(finished[1].model_key.as_deref(), Some(GPT41));

    let requests = h.provider.requests();
    assert_eq!(requests[1].model, "gpt-4.1");
    let texts: Vec<String> = requests[1]
        .messages
        .iter()
        .map(|m| match &m.content[0] {
            ContentPart::Text(t) => t.clone(),
            ContentPart::ImageUrl(_) => String::new(),
        })
        .collect();
    assert_eq!(
        texts,
        ["Capital of France?", "The capital is Paris.", "Population?"]
    );
}

#[tokio::test]
async fn regenerate_creates_a_sibling_with_another_model() {
    let h = harness();
    let first = h
        .service
        .send(send("Hi", NANO, None), h.sink.clone())
        .unwrap();
    h.sink.wait_finished(1).await;
    let original = first.messages[1].clone();
    h.provider.push(Script::reply("Second take"));
    let regen = h
        .service
        .regenerate(
            RegenerateRequest {
                message_id: original.id.clone(),
                model_key: Some(GEMINI.into()),
            },
            h.sink.clone(),
        )
        .unwrap();
    let sibling = &regen.messages[0];
    assert_eq!(sibling.parent_id, original.parent_id);
    assert_eq!(sibling.model_key.as_deref(), Some(GEMINI));
    assert_eq!(
        regen.conversation.current_leaf_id.as_ref(),
        Some(&sibling.id)
    );
    h.sink.wait_finished(2).await;
    let all = h.store.list_messages(&first.conversation.id).unwrap();
    assert_eq!(all.len(), 3, "original reply kept as another branch");

    // Branch navigation back to the original reply.
    let conversation = h
        .service
        .select_branch(&first.conversation.id, &original.id)
        .unwrap();
    assert_eq!(conversation.current_leaf_id.as_ref(), Some(&original.id));
}

#[tokio::test]
async fn edit_branches_from_the_edited_message() {
    let h = harness();
    let first = h
        .service
        .send(send("Tell me a joke", NANO, None), h.sink.clone())
        .unwrap();
    h.sink.wait_finished(1).await;
    let original_user = first.messages[0].clone();
    h.provider.push(Script::reply("A pun"));
    let edited = h
        .service
        .edit(
            EditRequest {
                message_id: original_user.id.clone(),
                content: "Tell me a pun".into(),
                model_key: NANO.into(),
            },
            h.sink.clone(),
        )
        .unwrap();
    let (new_user, new_reply) = (&edited.messages[0], &edited.messages[1]);
    assert_eq!(new_user.parent_id, original_user.parent_id);
    assert_eq!(new_user.content, "Tell me a pun");
    assert_eq!(new_reply.parent_id.as_ref(), Some(&new_user.id));
    assert_eq!(
        edited.conversation.current_leaf_id.as_ref(),
        Some(&new_reply.id)
    );
    h.sink.wait_finished(2).await;
    assert_eq!(
        h.store.list_messages(&first.conversation.id).unwrap().len(),
        4
    );
    let last_request = h.provider.requests().pop().unwrap();
    assert_eq!(
        last_request.messages.len(),
        1,
        "edited branch excludes the old exchange"
    );
}

#[tokio::test]
async fn compare_mode_streams_columns_and_continues_with_one() {
    let h = harness();
    h.provider.push(Script::reply("A says hi"));
    h.provider.push(Script::reply("B says hi"));
    let mut request = send("Hello both", NANO, None);
    request.compare_models = Some(vec![NANO.into(), GEMINI.into()]);
    let first = h.service.send(request, h.sink.clone()).unwrap();
    assert_eq!(
        first.messages.len(),
        3,
        "one shared user message + two replies"
    );
    let columns = first.conversation.compare.clone().unwrap();
    assert_eq!(columns.len(), 2);
    assert_eq!(columns[1].leaf_id.as_ref(), Some(&first.messages[2].id));
    h.sink.wait_finished(2).await;

    let second = h
        .service
        .send(
            send("Again", NANO, Some(&first.conversation.id)),
            h.sink.clone(),
        )
        .unwrap();
    assert_eq!(
        second.messages.len(),
        4,
        "one user message per column branch + two replies"
    );
    h.sink.wait_finished(4).await;
    let second_column_leaf = second.conversation.compare.as_ref().unwrap()[1]
        .leaf_id
        .clone();

    let ended = h
        .service
        .end_compare(&first.conversation.id, Some(1))
        .unwrap();
    assert_eq!(ended.compare, None);
    assert_eq!(ended.current_leaf_id, second_column_leaf);

    // Each column only saw its own branch.
    let requests = h.provider.requests();
    let last = requests.last().unwrap();
    assert_eq!(last.messages.len(), 3);
}

#[tokio::test]
async fn compare_needs_two_or_three_models() {
    let h = harness();
    let mut request = send("x", NANO, None);
    request.compare_models = Some(vec![NANO.into()]);
    assert!(matches!(
        h.service.send(request, h.sink.clone()),
        Err(CoreError::Invalid(_))
    ));
    let first = h
        .service
        .send(send("x", NANO, None), h.sink.clone())
        .unwrap();
    let four = vec![
        NANO.to_string(),
        GEMINI.into(),
        GPT41.into(),
        "mixroute:gpt-4o-mini".into(),
    ];
    assert!(
        h.service
            .start_compare(&first.conversation.id, &four)
            .is_err()
    );
    let started = h
        .service
        .start_compare(&first.conversation.id, &four[..2])
        .unwrap();
    assert_eq!(
        started.compare.unwrap()[0].leaf_id,
        first.conversation.current_leaf_id
    );
}

#[tokio::test]
async fn provider_errors_become_inline_message_errors() {
    let h = harness();
    h.provider.push(Script::partial_then_fail(
        "Half an ",
        ProviderError::RateLimited {
            retry_after_ms: Some(1000),
        },
    ));
    h.service
        .send(send("Hi", NANO, None), h.sink.clone())
        .unwrap();
    let finished = h.sink.wait_finished(1).await;
    assert_eq!(finished[0].status, MessageStatus::Error);
    assert_eq!(finished[0].content, "Half an ");
    let error = finished[0].error.clone().unwrap();
    assert_eq!(error.kind, ErrorKind::RateLimited);
    assert_eq!(error.retry_after_ms, Some(1000));
}

#[tokio::test]
async fn missing_key_is_reported_on_the_reply() {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let factory: Arc<dyn ProviderFactory> = Arc::new(MockFactory::default());
    let directory = Arc::new(ModelDirectory::new(
        Arc::new(Catalog::embedded().unwrap()),
        store.clone(),
        factory.clone(),
        None,
    ));
    let service = ChatService::with_flush_interval(store, directory, factory, Duration::ZERO);
    let sink = Arc::new(RecordingSink::default());
    service.send(send("Hi", NANO, None), sink.clone()).unwrap();
    let finished = sink.wait_finished(1).await;
    assert_eq!(
        finished[0].error.as_ref().map(|e| e.kind),
        Some(ErrorKind::MissingKey)
    );
}

#[tokio::test]
async fn images_are_blocked_for_models_without_vision() {
    let h = harness();
    let mut request = send("What color?", NANO, None);
    request.attachments = vec![image()];
    match h.service.send(request.clone(), h.sink.clone()) {
        Err(CoreError::Invalid(msg)) => assert!(msg.contains("can't read images")),
        other => panic!("expected an inline block, got {other:?}"),
    }
    request.model_key = GPT41.into();
    let result = h.service.send(request, h.sink.clone()).unwrap();
    assert_eq!(result.messages[0].attachments.len(), 1);
    h.sink.wait_finished(1).await;
    let sent = h.provider.requests().pop().unwrap();
    assert!(matches!(
        sent.messages[0].content[1],
        ContentPart::ImageUrl(_)
    ));
}

#[tokio::test]
async fn deleting_the_visible_reply_moves_the_branch_to_its_parent() {
    let h = harness();
    let first = h
        .service
        .send(send("Hi", NANO, None), h.sink.clone())
        .unwrap();
    h.sink.wait_finished(1).await;
    let conversation = h.service.delete_message(&first.messages[1].id).unwrap();
    assert_eq!(
        conversation.current_leaf_id.as_ref(),
        Some(&first.messages[0].id)
    );
    let conversation = h.service.delete_message(&first.messages[0].id).unwrap();
    assert_eq!(conversation.current_leaf_id, None);
}

#[tokio::test]
async fn generated_title_replaces_provisional_but_never_a_rename() {
    let h = harness();
    let mut settings = h.store.load_app_settings().unwrap();
    settings.auto_title = true;
    h.store.save_app_settings(&settings).unwrap();

    h.provider.push(Script::reply("Sure, here is a plan."));
    h.provider.push(Script::reply("\"Weekend trip plan.\""));
    let first = h
        .service
        .send(
            send("Plan my weekend trip to the coast", NANO, None),
            h.sink.clone(),
        )
        .unwrap();
    let titles = h.sink.wait_titles(1).await;
    assert_eq!(titles[0], "Weekend trip plan");
    let stored = h
        .store
        .get_conversation(&first.conversation.id)
        .unwrap()
        .unwrap();
    assert_eq!(stored.title_source, TitleSource::Generated);

    let renamed = h.service.rename(&first.conversation.id, "My trip").unwrap();
    assert_eq!(renamed.title_source, TitleSource::User);
    assert!(h.service.rename(&first.conversation.id, "  ").is_err());
}

#[tokio::test]
async fn recover_marks_interrupted_replies_and_removes_temporary_chats() {
    let h = harness();
    let mut request = send("secret", NANO, None);
    request.temporary = true;
    h.provider
        .push(Script::slow("a b c d e f", Duration::from_millis(200)));
    let result = h.service.send(request, h.sink.clone()).unwrap();
    assert!(
        h.store.list_conversations().unwrap().is_empty(),
        "temporary chats stay out of history"
    );
    h.service.recover().unwrap();
    assert_eq!(
        h.store.get_conversation(&result.conversation.id).unwrap(),
        None
    );
}

#[tokio::test]
async fn empty_messages_are_rejected() {
    let h = harness();
    assert!(matches!(
        h.service.send(send("   ", NANO, None), h.sink.clone()),
        Err(CoreError::Invalid(_))
    ));
}

#[tokio::test]
async fn system_prompt_and_settings_reach_the_provider() {
    let h = harness();
    let mut request = send("Hi", "mixroute:gemini-2.5-flash", None);
    request.settings = Some(ChatSettings {
        system_prompt: Some("Answer in French.".into()),
        temperature: Some(0.4),
        max_tokens: Some(300),
        reasoning_effort: Some(crate::types::ReasoningEffort::High),
    });
    h.service.send(request, h.sink.clone()).unwrap();
    h.sink.wait_finished(1).await;
    let sent = h.provider.requests().pop().unwrap();
    assert!(
        matches!(&sent.messages[0].content[0], ContentPart::Text(t) if t == "Answer in French.")
    );
    assert_eq!(sent.temperature, Some(0.4));
    assert_eq!(sent.max_tokens, Some(300));
    assert_eq!(
        sent.reasoning_effort,
        Some(crate::types::ReasoningEffort::High),
        "gemini 2.5 flash reasons"
    );
}
