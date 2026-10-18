//! Model catalog (§11.4): seeded metadata from `config/models.toml` merged with the
//! live model IDs each provider reports.
//!
//! Rules:
//! - A seeded model is shown only if its provider's live list contains it. When no live
//!   list is available at all (offline, never fetched), every seeded model is shown.
//! - Live IDs that are not seeded are shown with unknown metadata (name = ID).
//! - Dated snapshot IDs (`…-2025-04-14`) are hidden when the undated ID is also live.
//! - `hidden = true` seeds (non-chat models) are never shown.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::providers::ProviderId;
use crate::store::CachedModels;
use crate::types::Millis;

/// The seed file, embedded at compile time so the app needs no resource lookup.
const EMBEDDED_MODELS_TOML: &str = include_str!("../../../config/models.toml");

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("config/models.toml is invalid: {0}")]
    Parse(String),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelCaps {
    pub vision: bool,
    pub tools: bool,
    pub structured_output: bool,
    pub reasoning: bool,
    pub file_input: bool,
}

/// A model as the UI sees it (picker, chips, tiles, Models page).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    /// Unique key: `provider:modelId`.
    pub key: String,
    pub id: String,
    pub provider: ProviderId,
    pub name: String,
    /// Company that makes the model; drives avatar color and picker grouping.
    pub vendor: String,
    pub context_window: Option<u32>,
    /// USD per 1M input tokens; `None` = unknown.
    pub input_price: Option<f64>,
    /// USD per 1M output tokens; `None` = unknown.
    pub output_price: Option<f64>,
    /// Confirmed zero-priced.
    pub free: bool,
    pub caps: ModelCaps,
    /// Lower = more prominent on the home Models row.
    pub rank: Option<u32>,
    /// True when metadata comes from `config/models.toml`.
    pub seeded: bool,
    /// First reported by the provider since the previous app launch.
    pub is_new: bool,
    /// Structured output or tool calling: required to run agent steps later (§6).
    pub agent_eligible: bool,
}

impl ModelInfo {
    /// Cost of a request in USD, when both prices are known.
    pub fn cost_usd(&self, tokens_in: u32, tokens_out: u32) -> Option<f64> {
        if self.free {
            return Some(0.0);
        }
        let input = self.input_price?;
        let output = self.output_price?;
        Some((f64::from(tokens_in) * input + f64::from(tokens_out) * output) / 1_000_000.0)
    }
}

pub fn model_key(provider: ProviderId, id: &str) -> String {
    format!("{}:{id}", provider.slug())
}

/// Splits `provider:modelId` (model IDs may themselves contain colons).
pub fn parse_model_key(key: &str) -> Option<(ProviderId, &str)> {
    let (slug, id) = key.split_once(':')?;
    if id.is_empty() {
        return None;
    }
    Some((ProviderId::from_slug(slug)?, id))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SeedFile {
    defaults: SeedDefaults,
    #[serde(default)]
    tiers: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    models: Vec<SeedModel>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SeedDefaults {
    chat_model: String,
    title_model: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SeedModel {
    id: String,
    #[serde(default = "default_provider")]
    provider: String,
    name: String,
    vendor: String,
    context: Option<u32>,
    input_price: Option<f64>,
    output_price: Option<f64>,
    #[serde(default)]
    free: bool,
    #[serde(default)]
    vision: bool,
    #[serde(default)]
    tools: bool,
    #[serde(default)]
    structured_output: bool,
    #[serde(default)]
    reasoning: bool,
    #[serde(default)]
    file_input: bool,
    rank: Option<u32>,
    #[serde(default)]
    hidden: bool,
}

fn default_provider() -> String {
    ProviderId::Mixroute.slug().to_string()
}

/// Seeded model metadata plus defaults.
#[derive(Debug, Clone)]
pub struct Catalog {
    seeds: Vec<(ProviderId, SeedModel)>,
    pub default_chat_model: String,
    pub title_model: String,
    pub tiers: BTreeMap<String, Vec<String>>,
}

/// Live IDs per provider plus the previous launch time (for the "NEW" badge).
#[derive(Debug, Clone, Default)]
pub struct LiveModels {
    pub by_provider: HashMap<ProviderId, CachedModels>,
    pub previous_launch_at: Option<Millis>,
}

impl Catalog {
    pub fn embedded() -> Result<Catalog, CatalogError> {
        Catalog::parse(EMBEDDED_MODELS_TOML)
    }

    pub fn parse(text: &str) -> Result<Catalog, CatalogError> {
        let file: SeedFile =
            toml::from_str(text).map_err(|e| CatalogError::Parse(e.to_string()))?;
        let mut seen = HashSet::new();
        let mut seeds = Vec::with_capacity(file.models.len());
        for seed in file.models {
            let provider = ProviderId::from_slug(&seed.provider).ok_or_else(|| {
                CatalogError::Parse(format!(
                    "unknown provider `{}` for {}",
                    seed.provider, seed.id
                ))
            })?;
            if seed.free
                && (seed.input_price.unwrap_or(0.0) != 0.0
                    || seed.output_price.unwrap_or(0.0) != 0.0)
            {
                return Err(CatalogError::Parse(format!(
                    "{} is marked free but has a price",
                    seed.id
                )));
            }
            if !seen.insert(model_key(provider, &seed.id)) {
                return Err(CatalogError::Parse(format!("duplicate model {}", seed.id)));
            }
            seeds.push((provider, seed));
        }
        for key in [&file.defaults.chat_model, &file.defaults.title_model] {
            if parse_model_key(key).is_none() {
                return Err(CatalogError::Parse(format!(
                    "invalid default model key {key}"
                )));
            }
        }
        Ok(Catalog {
            seeds,
            default_chat_model: file.defaults.chat_model,
            title_model: file.defaults.title_model,
            tiers: file.tiers,
        })
    }

    /// Merges seeds with live IDs. `providers` lists the providers the user can reach
    /// (Mixroute always; direct providers only when they have a key).
    pub fn merge(&self, live: &LiveModels, providers: &[ProviderId]) -> Vec<ModelInfo> {
        let mut out = Vec::new();
        for &provider in providers {
            let live_list = live.by_provider.get(&provider);
            let live_ids: Option<HashMap<&str, &crate::store::CachedModel>> =
                live_list.map(|l| l.models.iter().map(|m| (m.id.as_str(), m)).collect());
            let is_new = |id: &str| -> bool {
                match (&live_ids, live.previous_launch_at) {
                    (Some(ids), Some(prev)) => ids.get(id).is_some_and(|m| m.first_seen_at > prev),
                    _ => false,
                }
            };

            let mut seeded_ids = HashSet::new();
            for (seed_provider, seed) in self.seeds.iter().filter(|(p, _)| *p == provider) {
                seeded_ids.insert(seed.id.as_str());
                if seed.hidden {
                    continue;
                }
                if let Some(ids) = &live_ids
                    && !ids.contains_key(seed.id.as_str())
                {
                    continue;
                }
                out.push(seed_info(*seed_provider, seed, is_new(&seed.id)));
            }

            if let Some(list) = live_list {
                let all_ids: HashSet<&str> = list.models.iter().map(|m| m.id.as_str()).collect();
                for m in &list.models {
                    if seeded_ids.contains(m.id.as_str()) || is_dated_alias(&m.id, &all_ids) {
                        continue;
                    }
                    out.push(unknown_info(
                        provider,
                        &m.id,
                        m.owned_by.as_deref(),
                        is_new(&m.id),
                    ));
                }
            }
        }
        out.sort_by(|a, b| {
            a.rank
                .unwrap_or(u32::MAX)
                .cmp(&b.rank.unwrap_or(u32::MAX))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        out
    }

    /// Looks up a seeded model by key (used for cost when the live list is unavailable).
    pub fn seeded(&self, key: &str) -> Option<ModelInfo> {
        let (provider, id) = parse_model_key(key)?;
        self.seeds
            .iter()
            .find(|(p, s)| *p == provider && s.id == id)
            .map(|(p, s)| seed_info(*p, s, false))
    }
}

fn seed_info(provider: ProviderId, seed: &SeedModel, is_new: bool) -> ModelInfo {
    let caps = ModelCaps {
        vision: seed.vision,
        tools: seed.tools,
        structured_output: seed.structured_output,
        reasoning: seed.reasoning,
        file_input: seed.file_input,
    };
    ModelInfo {
        key: model_key(provider, &seed.id),
        id: seed.id.clone(),
        provider,
        name: seed.name.clone(),
        vendor: seed.vendor.clone(),
        context_window: seed.context,
        input_price: if seed.free {
            Some(0.0)
        } else {
            seed.input_price
        },
        output_price: if seed.free {
            Some(0.0)
        } else {
            seed.output_price
        },
        free: seed.free,
        agent_eligible: caps.structured_output || caps.tools,
        caps,
        rank: seed.rank,
        seeded: true,
        is_new,
    }
}

fn unknown_info(provider: ProviderId, id: &str, owned_by: Option<&str>, is_new: bool) -> ModelInfo {
    ModelInfo {
        key: model_key(provider, id),
        id: id.to_string(),
        provider,
        name: id.to_string(),
        vendor: vendor_from_owner(provider, id, owned_by),
        context_window: None,
        input_price: None,
        output_price: None,
        free: false,
        caps: ModelCaps::default(),
        rank: None,
        seeded: false,
        is_new,
        agent_eligible: false,
    }
}

/// Best-effort vendor name for an unseeded model (only used for grouping and avatar color).
fn vendor_from_owner(provider: ProviderId, id: &str, owned_by: Option<&str>) -> String {
    let lower = id.to_lowercase();
    let by_prefix = [
        ("gpt", "OpenAI"),
        ("o1", "OpenAI"),
        ("o3", "OpenAI"),
        ("o4", "OpenAI"),
        ("claude", "Anthropic"),
        ("gemini", "Google"),
        ("gemma", "Google"),
        ("deepseek", "DeepSeek"),
        ("qwen", "Alibaba"),
        ("kimi", "Moonshot"),
        ("glm", "Zhipu"),
        ("minimax", "MiniMax"),
        ("grok", "xAI"),
        ("mistral", "Mistral"),
        ("llama", "Meta"),
    ];
    // OpenRouter-style IDs carry the vendor as a prefix: `vendor/model`.
    let tail = lower.rsplit('/').next().unwrap_or(&lower);
    if let Some((_, vendor)) = by_prefix.iter().find(|(p, _)| tail.starts_with(p)) {
        return (*vendor).to_string();
    }
    match owned_by {
        Some(owner) if !owner.is_empty() && provider != ProviderId::Mixroute => owner.to_string(),
        _ => provider.display_name().to_string(),
    }
}

/// `gpt-4.1-2025-04-14` is an alias when `gpt-4.1` is also live.
fn is_dated_alias(id: &str, all_ids: &HashSet<&str>) -> bool {
    let bytes = id.as_bytes();
    if bytes.len() < 12 {
        return false;
    }
    let (base, suffix) = id.split_at(id.len() - 11);
    let is_date = suffix.starts_with('-')
        && suffix[1..].char_indices().all(|(i, c)| {
            if i == 4 || i == 7 {
                c == '-'
            } else {
                c.is_ascii_digit()
            }
        });
    is_date && all_ids.contains(base)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::CachedModel;

    fn live(ids: &[(&str, Millis)], previous_launch_at: Option<Millis>) -> LiveModels {
        let models = ids
            .iter()
            .map(|(id, first)| CachedModel {
                id: id.to_string(),
                owned_by: Some("openai".into()),
                first_seen_at: *first,
            })
            .collect();
        LiveModels {
            by_provider: HashMap::from([(
                ProviderId::Mixroute,
                CachedModels {
                    fetched_at: 1,
                    models,
                },
            )]),
            previous_launch_at,
        }
    }

    #[test]
    fn embedded_catalog_parses_and_has_required_seeds() {
        let catalog = Catalog::embedded().unwrap();
        for id in [
            "gpt-4.1-nano",
            "gpt-4.1-mini",
            "gpt-4.1",
            "deepseek-v4-flash",
            "gemini-2.5-flash",
            "gemini-3.5-flash-lite",
            "glm-4-flash",
        ] {
            assert!(
                catalog.seeded(&format!("mixroute:{id}")).is_some(),
                "missing seed {id}"
            );
        }
        assert_eq!(catalog.default_chat_model, "mixroute:gpt-4.1-nano");
        assert!(catalog.tiers.contains_key("t1"));
    }

    #[test]
    fn unconfirmed_prices_stay_unknown() {
        let catalog = Catalog::embedded().unwrap();
        let nano = catalog.seeded("mixroute:gpt-4.1-nano").unwrap();
        assert_eq!(nano.input_price, None);
        assert_eq!(nano.cost_usd(1000, 1000), None);
        let glm = catalog.seeded("mixroute:glm-4-flash").unwrap();
        assert!(!glm.free, "glm-4-flash is not confirmed in /models");
        let gpt5 = catalog.seeded("mixroute:gpt-5").unwrap();
        assert_eq!(gpt5.input_price, Some(1.25));
        let cost = gpt5.cost_usd(1_000_000, 100_000).unwrap();
        assert!((cost - 2.25).abs() < 1e-9);
    }

    #[test]
    fn merge_hides_seeds_missing_from_live_list_and_adds_unknowns() {
        let catalog = Catalog::embedded().unwrap();
        let live = live(
            &[
                ("gpt-4.1-nano", 1),
                ("gpt-4.1-nano-2025-04-14", 1),
                ("brand-new-model", 1),
                ("gemini-2.5-flash-image", 1),
            ],
            None,
        );
        let models = catalog.merge(&live, &[ProviderId::Mixroute]);
        let keys: Vec<_> = models.iter().map(|m| m.key.as_str()).collect();
        assert!(keys.contains(&"mixroute:gpt-4.1-nano"));
        assert!(keys.contains(&"mixroute:brand-new-model"));
        assert!(
            !keys.contains(&"mixroute:gpt-4.1-nano-2025-04-14"),
            "dated alias hidden"
        );
        assert!(
            !keys.contains(&"mixroute:gemini-2.5-flash-image"),
            "hidden seed"
        );
        assert!(!keys.contains(&"mixroute:gpt-5"), "not live");
        let unknown = models.iter().find(|m| m.id == "brand-new-model").unwrap();
        assert!(!unknown.seeded);
        assert_eq!(unknown.input_price, None);
        assert!(!unknown.agent_eligible);
    }

    #[test]
    fn merge_without_live_list_falls_back_to_all_visible_seeds() {
        let catalog = Catalog::embedded().unwrap();
        let models = catalog.merge(&LiveModels::default(), &[ProviderId::Mixroute]);
        assert!(models.iter().any(|m| m.id == "gpt-5"));
        assert!(models.iter().any(|m| m.id == "glm-4-flash"));
        assert!(!models.iter().any(|m| m.id == "gemini-2.5-flash-image"));
        // Ranked models come first, in rank order.
        assert_eq!(models[0].id, "gpt-5");
    }

    #[test]
    fn new_badge_needs_a_previous_launch() {
        let catalog = Catalog::embedded().unwrap();
        let first_run = catalog.merge(&live(&[("gpt-5", 500)], None), &[ProviderId::Mixroute]);
        assert!(!first_run[0].is_new);
        let later = catalog.merge(
            &live(&[("gpt-5", 500), ("gpt-4.1", 50)], Some(100)),
            &[ProviderId::Mixroute],
        );
        let gpt5 = later.iter().find(|m| m.id == "gpt-5").unwrap();
        let gpt41 = later.iter().find(|m| m.id == "gpt-4.1").unwrap();
        assert!(gpt5.is_new);
        assert!(!gpt41.is_new);
    }

    #[test]
    fn model_keys_round_trip_and_allow_colons_in_ids() {
        assert_eq!(
            parse_model_key("mixroute:gpt-4.1"),
            Some((ProviderId::Mixroute, "gpt-4.1"))
        );
        assert_eq!(
            parse_model_key("openrouter:meta/llama:free"),
            Some((ProviderId::OpenRouter, "meta/llama:free"))
        );
        assert_eq!(parse_model_key("nope:x"), None);
        assert_eq!(parse_model_key("mixroute:"), None);
        assert_eq!(model_key(ProviderId::OpenAi, "gpt-5"), "openai:gpt-5");
    }

    #[test]
    fn invalid_seed_files_are_rejected() {
        let bad_provider = "[defaults]\nchat_model='mixroute:a'\ntitle_model='mixroute:a'\n[[models]]\nid='a'\nname='A'\nvendor='V'\nprovider='nope'\n";
        assert!(Catalog::parse(bad_provider).is_err());
        let free_with_price = "[defaults]\nchat_model='mixroute:a'\ntitle_model='mixroute:a'\n[[models]]\nid='a'\nname='A'\nvendor='V'\nfree=true\ninput_price=1.0\n";
        assert!(Catalog::parse(free_with_price).is_err());
        let duplicate = "[defaults]\nchat_model='mixroute:a'\ntitle_model='mixroute:a'\n[[models]]\nid='a'\nname='A'\nvendor='V'\n[[models]]\nid='a'\nname='A'\nvendor='V'\n";
        assert!(Catalog::parse(duplicate).is_err());
    }

    #[test]
    fn vendor_guess_for_unseeded_ids() {
        assert_eq!(
            vendor_from_owner(ProviderId::OpenRouter, "anthropic/claude-x", None),
            "Anthropic"
        );
        assert_eq!(
            vendor_from_owner(ProviderId::Mixroute, "mystery", Some("openai")),
            "Mixroute"
        );
        assert_eq!(
            vendor_from_owner(ProviderId::OpenAi, "mystery", Some("acme")),
            "acme"
        );
    }
}
