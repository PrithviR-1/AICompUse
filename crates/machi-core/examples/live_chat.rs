//! Live end-to-end check of the chat service against Mixroute (Phase 0 exit criteria).
//! Run: `cargo run --example live_chat`. Uses the debug `.env` fallback for the key and an
//! in-memory database. Prints statuses and token counts only — never the key.
//!
//! Covers, with a cheap and a premium model: streaming, stop, model switching mid-chat
//! (context kept), regenerate and edit branching, compare mode, image attachments on a
//! vision model (and the block on a non-vision one), title generation and the live model list.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use machi_core::app::MachiCore;
use machi_core::chat::{ChatEvent, ChatSink, EditRequest, RegenerateRequest, SendRequest};
use machi_core::secrets::{DevEnv, MemoryStore};
use machi_core::store::Store;
use machi_core::types::{AttachmentKind, Message, MessageStatus, NewAttachment};

const CHEAP: &str = "mixroute:gpt-4.1-nano";
const PREMIUM: &str = "mixroute:gpt-4.1";
const RED_PNG: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42mO4o6ZGU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAIjyoD2JhwFtAAAAAElFTkSuQmCC";

#[derive(Default)]
struct Sink {
    events: Mutex<Vec<ChatEvent>>,
}

impl ChatSink for Sink {
    fn send(&self, event: ChatEvent) {
        if let Ok(mut events) = self.events.lock() {
            events.push(event);
        }
    }
}

impl Sink {
    fn finished(&self, id: &str) -> Option<Message> {
        self.events.lock().ok()?.iter().find_map(|e| match e {
            ChatEvent::Finished(f) if f.message.id == id => Some(f.message.clone()),
            _ => None,
        })
    }

    fn deltas(&self, id: &str) -> usize {
        self.events
            .lock()
            .map(|events| {
                events
                    .iter()
                    .filter(|e| matches!(e, ChatEvent::Delta(d) if d.message_id == id))
                    .count()
            })
            .unwrap_or(0)
    }

    fn has_title(&self, conversation_id: &str) -> bool {
        self.events
            .lock()
            .map(|events| {
                events.iter().any(
                    |e| matches!(e, ChatEvent::Title(t) if t.conversation_id == conversation_id),
                )
            })
            .unwrap_or(false)
    }

    async fn wait(&self, id: &str) -> Message {
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            if let Some(m) = self.finished(id) {
                return m;
            }
            if Instant::now() > deadline {
                eprintln!("timed out waiting for {id}");
                std::process::exit(1);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

struct Report {
    failures: usize,
}

impl Report {
    fn check(&mut self, label: &str, ok: bool, detail: impl AsRef<str>) {
        if !ok {
            self.failures += 1;
        }
        println!(
            "{:<44} {}  {}",
            label,
            if ok { "ok  " } else { "FAIL" },
            detail.as_ref()
        );
    }
}

fn describe(m: &Message) -> String {
    format!(
        "{:?} · {} chars · tokens {:?}/{:?} · {:?} ms",
        m.status,
        m.content.chars().count(),
        m.tokens_in,
        m.tokens_out,
        m.elapsed_ms
    )
}

fn request(conversation_id: Option<&str>, content: &str, model: &str) -> SendRequest {
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

#[tokio::main]
async fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let store = match Store::open_in_memory() {
        Ok(s) => Arc::new(s),
        Err(err) => {
            eprintln!("store: {err}");
            std::process::exit(2);
        }
    };
    let core = match MachiCore::with_store(
        store,
        Arc::new(MemoryStore::default()),
        Some(DevEnv::load(&root)),
    ) {
        Ok(c) => c,
        Err(err) => {
            eprintln!("core: {err}");
            std::process::exit(2);
        }
    };
    let mut r = Report { failures: 0 };
    let sink = Arc::new(Sink::default());

    let list = core.list_models(true).await;
    r.check(
        "live model list",
        list.fetched_at.is_some() && list.refresh_error.is_none(),
        format!("{} models", list.models.len()),
    );

    for model in [CHEAP, PREMIUM] {
        let label = model.trim_start_matches("mixroute:");
        // Streaming.
        let sent = match core.chat.send(
            request(
                None,
                "Name three primary colors in one short sentence.",
                model,
            ),
            sink.clone(),
        ) {
            Ok(s) => s,
            Err(err) => {
                r.check(&format!("[{label}] send"), false, err.to_string());
                continue;
            }
        };
        let reply_id = sent.messages[1].id.clone();
        let reply = sink.wait(&reply_id).await;
        r.check(
            &format!("[{label}] streaming reply"),
            reply.status == MessageStatus::Complete
                && !reply.content.is_empty()
                && sink.deltas(&reply_id) > 0,
            format!(
                "{} · {} delta events",
                describe(&reply),
                sink.deltas(&reply_id)
            ),
        );
        let conversation_id = sent.conversation.id.clone();

        // Stop.
        let long = core
            .chat
            .send(
                request(
                    Some(&conversation_id),
                    "Write a 600-word story about a lighthouse keeper.",
                    model,
                ),
                sink.clone(),
            )
            .ok();
        if let Some(long) = long {
            let id = long.messages[1].id.clone();
            let deadline = Instant::now() + Duration::from_secs(60);
            while sink.deltas(&id) == 0 && Instant::now() < deadline {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let stopped = core.chat.stop(&id);
            let m = sink.wait(&id).await;
            r.check(
                &format!("[{label}] stop mid-stream"),
                stopped && m.status == MessageStatus::Stopped,
                describe(&m),
            );
        }

        // Model switching mid-chat keeps context.
        let other = if model == CHEAP { PREMIUM } else { CHEAP };
        if let Ok(switched) = core.chat.send(
            request(
                Some(&conversation_id),
                "What was my first question in this chat? Answer in a few words.",
                other,
            ),
            sink.clone(),
        ) {
            let m = sink.wait(&switched.messages[1].id).await;
            let mentions_colors = m.content.to_lowercase().contains("color")
                || m.content.to_lowercase().contains("colour");
            r.check(
                &format!(
                    "[{label}] switch to {} keeps context",
                    other.trim_start_matches("mixroute:")
                ),
                m.status == MessageStatus::Complete
                    && mentions_colors
                    && m.model_key.as_deref() == Some(other),
                describe(&m),
            );
        }

        // Regenerate → sibling branch.
        if let Ok(regen) = core.chat.regenerate(
            RegenerateRequest {
                message_id: reply_id.clone(),
                model_key: Some(model.into()),
            },
            sink.clone(),
        ) {
            let m = sink.wait(&regen.messages[0].id).await;
            let siblings = core
                .get_conversation(&conversation_id)
                .map(|d| {
                    d.messages
                        .iter()
                        .filter(|x| x.parent_id == reply.parent_id)
                        .count()
                })
                .unwrap_or(0);
            r.check(
                &format!("[{label}] regenerate branch"),
                m.status == MessageStatus::Complete && siblings == 2,
                format!("{siblings} siblings · {}", describe(&m)),
            );
        }

        // Edit → new user branch.
        let first_user = sent.messages[0].id.clone();
        if let Ok(edited) = core.chat.edit(
            EditRequest {
                message_id: first_user,
                content: "Name three secondary colors in one short sentence.".into(),
                model_key: model.into(),
            },
            sink.clone(),
        ) {
            let m = sink.wait(&edited.messages[1].id).await;
            let leaf_ok = edited.conversation.current_leaf_id.as_deref()
                == Some(edited.messages[1].id.as_str());
            r.check(
                &format!("[{label}] edit branch"),
                m.status == MessageStatus::Complete && leaf_ok,
                describe(&m),
            );
        }

        // Title generation after the first exchange.
        let deadline = Instant::now() + Duration::from_secs(60);
        while !sink.has_title(&conversation_id) && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let title = core
            .get_conversation(&conversation_id)
            .map(|d| d.conversation.title)
            .unwrap_or_default();
        r.check(
            &format!("[{label}] generated title"),
            sink.has_title(&conversation_id),
            format!("{} chars", title.chars().count()),
        );
    }

    // Compare mode with the cheap and premium models.
    let mut compare = request(None, "Say hello in French.", CHEAP);
    compare.compare_models = Some(vec![CHEAP.into(), PREMIUM.into()]);
    match core.chat.send(compare, sink.clone()) {
        Ok(sent) => {
            let a = sink.wait(&sent.messages[1].id).await;
            let b = sink.wait(&sent.messages[2].id).await;
            r.check(
                "compare: two columns stream independently",
                a.status == MessageStatus::Complete
                    && b.status == MessageStatus::Complete
                    && a.model_key != b.model_key,
                format!("{} | {}", describe(&a), describe(&b)),
            );
            let ended = core.chat.end_compare(&sent.conversation.id, Some(1));
            r.check(
                "compare: continue with column 2",
                ended.as_ref().is_ok_and(|c| {
                    c.compare.is_none() && c.current_leaf_id.as_deref() == Some(b.id.as_str())
                }),
                "",
            );
        }
        Err(err) => r.check("compare", false, err.to_string()),
    }

    // Image attachments: accepted on a vision model, blocked on a non-vision one.
    let image = NewAttachment {
        kind: AttachmentKind::Image,
        name: "red.png".into(),
        mime: "image/png".into(),
        size: 120,
        data: RED_PNG.into(),
    };
    let mut vision = request(None, "What color is this image? One word.", PREMIUM);
    vision.attachments = vec![image.clone()];
    match core.chat.send(vision, sink.clone()) {
        Ok(sent) => {
            let m = sink.wait(&sent.messages[1].id).await;
            r.check(
                "image on gpt-4.1 (vision)",
                m.status == MessageStatus::Complete
                    && m.content.to_lowercase().contains("red")
                    && m.tokens_in.unwrap_or(0) > 60,
                describe(&m),
            );
        }
        Err(err) => r.check("image on gpt-4.1 (vision)", false, err.to_string()),
    }
    let mut blocked = request(None, "What color is this image?", CHEAP);
    blocked.attachments = vec![image];
    r.check(
        "image blocked on gpt-4.1-nano",
        core.chat.send(blocked, sink.clone()).is_err(),
        "inline validation error",
    );

    if r.failures > 0 {
        println!("{} check(s) failed", r.failures);
        std::process::exit(1);
    }
    println!("all live checks passed");
}
