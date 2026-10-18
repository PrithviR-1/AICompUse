//! Writes `src/lib/mock/models.fixture.json`: the model list the browser mock backend shows,
//! produced by the real catalog merge so the mock can't drift from the app.
//! Run after `node scripts/sync-models.mjs`: `cargo run -p machi-core --example export_model_fixture`.

use std::collections::HashMap;

use machi_core::models::{Catalog, LiveModels};
use machi_core::providers::ProviderId;
use machi_core::store::{CachedModel, CachedModels};

/// The account's live IDs (2026-10-18) plus a showcase of catalogue models: frontier
/// flagships, non-chat types, a free model and an ID with no metadata.
const IDS: &[&str] = &[
    "MiniMax-M2.5",
    "deepseek-v4-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-image",
    "gemini-3.5-flash-lite",
    "gpt-4.1",
    "gpt-4.1-2025-04-14",
    "gpt-4.1-mini",
    "gpt-4.1-mini-2025-04-14",
    "gpt-4.1-nano",
    "gpt-4.1-nano-2025-04-14",
    "gpt-4o-2024-08-06",
    "gpt-4o-2024-11-20",
    "gpt-4o-mini",
    "gpt-4o-mini-2024-07-18",
    "gpt-5",
    "gpt-5-2025-08-07",
    "gpt-5-mini",
    "gpt-5-mini-2025-08-07",
    "gpt-5-nano",
    "gpt-5-nano-2025-08-07",
    "kimi-k2.5",
    "qwen3.6-flash",
    "gpt-6-astra",
    "claude-fable-5-1",
    "claude-opus-5-5",
    "gemini-4-argon",
    "grok-4.7",
    "kimi-k3",
    "gpt-6-sol",
    "sora-2",
    "text-embedding-3-small",
    "whisper-1",
    "glm-4-flash",
    "brand-new-model-x",
];

fn main() {
    let catalog = match Catalog::embedded() {
        Ok(c) => c,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    };
    let models = IDS
        .iter()
        .map(|id| CachedModel {
            id: (*id).to_string(),
            owned_by: Some("openai".into()),
            endpoint_types: vec!["openai".into()],
            first_seen_at: if *id == "gemini-4-argon" { 2 } else { 0 },
        })
        .collect();
    let live = LiveModels {
        by_provider: HashMap::from([(
            ProviderId::Mixroute,
            CachedModels {
                fetched_at: 1,
                models,
            },
        )]),
        previous_launch_at: Some(1),
    };
    let list = catalog.merge(&live, &[ProviderId::Mixroute]);
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../src/lib/mock/models.fixture.json");
    match serde_json::to_string_pretty(&list).map(|json| std::fs::write(&path, json + "\n")) {
        Ok(Ok(())) => println!("wrote {} models to {}", list.len(), path.display()),
        Ok(Err(err)) => {
            eprintln!("write failed: {err}");
            std::process::exit(1);
        }
        Err(err) => {
            eprintln!("serialize failed: {err}");
            std::process::exit(1);
        }
    }
}
