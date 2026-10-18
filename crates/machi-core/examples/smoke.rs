//! Live smoke test against Mixroute (§12 Phase 0 step 4). Run: `cargo run --example smoke`.
//!
//! Loads `.env` from the project root itself (debug build), then checks:
//! `GET /models` and streaming "Hello" on the cheap and premium models (failures make the
//! run fail), and reports per-model capability probes: image input (the image must
//! actually be consumed: >60 prompt tokens and the right answer) and structured output
//! (`json_schema` strict, then `json_object`). Prints only statuses, latencies, token
//! counts and supported/unsupported — never the key and never model output.

use std::sync::Arc;
use std::time::Instant;

use machi_core::providers::types::{ChatMessage, ChatRequest, ChatRole, ContentPart, StreamEvent};
use machi_core::providers::{ChatProvider, OpenAiCompatible, ProviderId};
use machi_core::secrets::{DevEnv, MemoryStore, Secrets};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

const CHEAP: &str = "gpt-4.1-nano";
/// gpt-5 and gpt-5-mini are refused upstream for this account (organization verification).
const PREMIUM: &str = "gpt-4.1";
/// 32×32 solid red PNG.
const RED_PNG: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42mO4o6ZGU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAIjyoD2JhwFtAAAAAElFTkSuQmCC";

#[tokio::main]
async fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let secrets = Secrets::new(Arc::new(MemoryStore::default()), Some(DevEnv::load(&root)));
    let Ok(Some((key, _))) = secrets.api_key(ProviderId::Mixroute) else {
        eprintln!("MIXROUTE_API_KEY not found in .env or the environment");
        std::process::exit(2);
    };
    let base_url = secrets
        .dev_base_url(ProviderId::Mixroute)
        .unwrap_or_else(|| ProviderId::Mixroute.default_base_url().to_string());
    let adapter = match OpenAiCompatible::new(ProviderId::Mixroute, &base_url, key.clone()) {
        Ok(a) => a,
        Err(err) => {
            eprintln!("could not build client: {err}");
            std::process::exit(2);
        }
    };

    let mut failures = 0;

    // 1. Model list.
    let started = Instant::now();
    match adapter.list_models().await {
        Ok(models) => println!(
            "models:            ok    {:>5} ms  {} ids",
            started.elapsed().as_millis(),
            models.len()
        ),
        Err(err) => {
            failures += 1;
            println!("models:            FAIL  {err}");
        }
    }

    // 2. Streaming "Hello" on the cheap and premium models.
    for model in [CHEAP, PREMIUM] {
        let request = ChatRequest::new(model, vec![ChatMessage::text(ChatRole::User, "Hello")]);
        failures += usize::from(!stream(&adapter, &request, &format!("stream {model}")).await);
    }

    // 3. Capability probes (reported, not failures): image input and structured output.
    for model in [CHEAP, PREMIUM, "gemini-2.5-flash"] {
        image_input(&adapter, model).await;
    }
    for model in [CHEAP, "gemini-2.5-flash"] {
        structured_output(&base_url, key.expose(), model, true).await;
        structured_output(&base_url, key.expose(), model, false).await;
    }

    if failures > 0 {
        println!("{failures} check(s) failed");
        std::process::exit(1);
    }
    println!("all checks passed");
}

async fn stream(adapter: &OpenAiCompatible, request: &ChatRequest, label: &str) -> bool {
    let started = Instant::now();
    let mut first_token_ms = None;
    let mut chars = 0usize;
    let cancel = CancellationToken::new();
    let mut on_event = |e: StreamEvent| {
        if let StreamEvent::Delta(d) = e {
            first_token_ms.get_or_insert(started.elapsed().as_millis());
            chars += d.len();
        }
    };
    match adapter.stream_chat(request, &mut on_event, &cancel).await {
        Ok(outcome) => {
            println!(
                "{label:<18} ok    {:>5} ms  first token {:?} ms  tokens in/out {:?}/{:?}  finish {:?}",
                started.elapsed().as_millis(),
                first_token_ms,
                outcome.usage.map(|u| u.prompt_tokens),
                outcome.usage.map(|u| u.completion_tokens),
                outcome.finish_reason.as_deref().unwrap_or("-")
            );
            chars > 0
        }
        Err(err) => {
            println!("{label:<18} FAIL  {err}");
            false
        }
    }
}

async fn image_input(adapter: &OpenAiCompatible, model: &str) {
    let request = ChatRequest::new(
        model,
        vec![ChatMessage {
            role: ChatRole::User,
            content: vec![
                ContentPart::Text("What color is this image? Answer with one word.".into()),
                ContentPart::ImageUrl(RED_PNG.into()),
            ],
        }],
    );
    let mut answer = String::new();
    let started = Instant::now();
    let cancel = CancellationToken::new();
    let mut collect = |e: StreamEvent| {
        if let StreamEvent::Delta(d) = e {
            answer.push_str(&d);
        }
    };
    let label = format!("image {model}");
    match adapter.stream_chat(&request, &mut collect, &cancel).await {
        Ok(outcome) => {
            let prompt_tokens = outcome.usage.map(|u| u.prompt_tokens).unwrap_or(0);
            let supported = prompt_tokens > 60 && answer.to_lowercase().contains("red");
            println!(
                "{label:<30} {}  {:>5} ms  prompt tokens {prompt_tokens}",
                if supported {
                    "supported  "
                } else {
                    "unsupported"
                },
                started.elapsed().as_millis(),
            );
        }
        Err(err) => println!("{label:<30} error        {err}"),
    }
}

async fn structured_output(base_url: &str, key: &str, model: &str, strict: bool) {
    let response_format = if strict {
        json!({
            "type": "json_schema",
            "json_schema": {
                "name": "answer",
                "strict": true,
                "schema": {
                    "type": "object",
                    "properties": {"value": {"type": "integer"}},
                    "required": ["value"],
                    "additionalProperties": false
                }
            }
        })
    } else {
        json!({"type": "json_object"})
    };
    let body = json!({
        "model": model,
        "messages": [{"role": "user", "content": "Return the number 7 as JSON in the form {\"value\": 7}."}],
        "response_format": response_format,
    });
    let label = format!(
        "{} {model}",
        if strict {
            "json_schema strict"
        } else {
            "json_object"
        }
    );
    let started = Instant::now();
    let response = reqwest::Client::new()
        .post(format!("{base_url}/chat/completions"))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await;
    let response = match response {
        Ok(r) => r,
        Err(err) => {
            println!("{label:<30} error        {}", err.without_url());
            return;
        }
    };
    let status = response.status();
    let value: Value = response.json().await.unwrap_or(Value::Null);
    let content = value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("");
    let parsed: Option<Value> = serde_json::from_str(content.trim()).ok();
    let valid = parsed
        .as_ref()
        .is_some_and(|v| v["value"].as_i64() == Some(7));
    println!(
        "{label:<30} {}  {:>5} ms  HTTP {}",
        if valid { "supported  " } else { "unsupported" },
        started.elapsed().as_millis(),
        status.as_u16(),
    );
}
