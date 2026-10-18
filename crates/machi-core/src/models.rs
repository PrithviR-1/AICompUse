//! Model catalog (§11.4): every model ID a provider's `GET /models` returns, enriched with
//! metadata from `config/models.generated.json` (Mixroute's public catalogue) and
//! `config/models.toml` (frontier flags, live-verified overrides).
//!
//! Rules:
//! - Every live ID is shown. A model with no metadata still appears, with unknown price.
//! - When no live list was ever fetched, the `[fallback]` IDs from models.toml are shown.
//! - Only text-output models whose endpoints include the OpenAI-compatible one can chat;
//!   everything else is listed but marked unavailable with a reason.
//! - Default order: frontier models by output price (high → low), then the rest by output
//!   price, then models with unknown price, then free models.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::providers::ProviderId;
use crate::store::CachedModels;
use crate::types::Millis;

/// Embedded at compile time so the app needs no resource lookup.
const EMBEDDED_MODELS_TOML: &str = include_str!("../../../config/models.toml");
const EMBEDDED_GENERATED_JSON: &str = include_str!("../../../config/models.generated.json");

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("model config is invalid: {0}")]
    Parse(String),
}

/// What a model produces; only `Chat` models can be used in a conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ModelKind {
    Chat,
    Image,
    Video,
    Audio,
    Embedding,
    Rerank,
    Transcription,
    Other,
}

impl ModelKind {
    fn label(self) -> &'static str {
        match self {
            ModelKind::Chat => "chat",
            ModelKind::Image => "image",
            ModelKind::Video => "video",
            ModelKind::Audio => "audio",
            ModelKind::Embedding => "embedding",
            ModelKind::Rerank => "rerank",
            ModelKind::Transcription => "transcription",
            ModelKind::Other => "non-chat",
        }
    }

    /// Classification for an ID with no catalogue entry (newly added models).
    fn from_id(id: &str) -> ModelKind {
        let lower = id.to_lowercase();
        if lower.contains("embed") {
            ModelKind::Embedding
        } else if lower.contains("rerank") {
            ModelKind::Rerank
        } else if lower.contains("whisper") || lower.contains("transcri") {
            ModelKind::Transcription
        } else {
            ModelKind::Chat
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PricingUnit {
    PerToken,
    PerCall,
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
    /// Company that makes the model; drives avatar color and grouping.
    pub vendor: String,
    pub kind: ModelKind,
    pub input_modalities: Vec<String>,
    pub output_modalities: Vec<String>,
    pub context_window: Option<u32>,
    pub max_output: Option<u32>,
    pub pricing: PricingUnit,
    /// USD per 1M input tokens; `None` = unknown.
    pub input_price: Option<f64>,
    /// USD per 1M output tokens; `None` = unknown.
    pub output_price: Option<f64>,
    /// USD per 1M cached input tokens (cache read); `None` = not listed.
    pub cached_input_price: Option<f64>,
    /// USD per request for per-call models.
    pub per_call_price: Option<f64>,
    /// Price depends on prompt length; the standard tier is shown.
    pub tiered_pricing: bool,
    /// Both token prices are confirmed zero.
    pub free: bool,
    pub caps: ModelCaps,
    /// A current flagship model (config/models.toml `[frontier]`).
    pub frontier: bool,
    /// Endpoint types the provider reports (`openai`, `anthropic`, `gemini`, …).
    pub endpoint_types: Vec<String>,
    /// Can be used in a chat in this build.
    pub chat_supported: bool,
    /// Why it can't be chatted with, when `chat_supported` is false.
    pub unavailable_reason: Option<String>,
    /// True when catalogue metadata exists for this ID.
    pub has_metadata: bool,
    /// First reported by the provider since the previous app launch.
    pub is_new: bool,
    /// Structured output or tool calling: required to run agent steps later (§6).
    pub agent_eligible: bool,
}

impl ModelInfo {
    /// Cost of a request in USD, when both token prices are known.
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

// ---- config files -----------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfigFile {
    defaults: ConfigDefaults,
    #[serde(default)]
    tiers: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    frontier: IdList,
    #[serde(default)]
    fallback: IdList,
    #[serde(default)]
    overrides: Vec<Override>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfigDefaults {
    chat_model: String,
    title_model: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct IdList {
    models: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Override {
    id: String,
    name: Option<String>,
    vision: Option<bool>,
    tools: Option<bool>,
    structured_output: Option<bool>,
    reasoning: Option<bool>,
    file_input: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedFile {
    models: Vec<GeneratedModel>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedModel {
    id: String,
    name: String,
    vendor: Option<String>,
    kind: ModelKind,
    input_modalities: Option<Vec<String>>,
    output_modalities: Option<Vec<String>>,
    context_window: Option<u32>,
    max_output: Option<u32>,
    pricing: String,
    input_price: Option<f64>,
    output_price: Option<f64>,
    cached_input_price: Option<f64>,
    per_call_price: Option<f64>,
    #[serde(default)]
    tiered_pricing: bool,
    capabilities: GeneratedCaps,
    #[serde(default)]
    endpoints: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct GeneratedCaps {
    tools: Option<bool>,
    structured_output: Option<bool>,
    reasoning: Option<bool>,
    vision: Option<bool>,
    file_input: Option<bool>,
}

/// Seeded metadata plus defaults.
#[derive(Debug, Clone)]
pub struct Catalog {
    generated: HashMap<String, GeneratedModel>,
    overrides: HashMap<String, Override>,
    frontier: HashSet<String>,
    fallback: Vec<String>,
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
        Catalog::parse(EMBEDDED_MODELS_TOML, EMBEDDED_GENERATED_JSON)
    }

    pub fn parse(config_toml: &str, generated_json: &str) -> Result<Catalog, CatalogError> {
        let config: ConfigFile =
            toml::from_str(config_toml).map_err(|e| CatalogError::Parse(e.to_string()))?;
        let generated: GeneratedFile = serde_json::from_str(generated_json)
            .map_err(|e| CatalogError::Parse(format!("models.generated.json: {e}")))?;
        for key in [&config.defaults.chat_model, &config.defaults.title_model] {
            if parse_model_key(key).is_none() {
                return Err(CatalogError::Parse(format!(
                    "invalid default model key {key}"
                )));
            }
        }
        let mut overrides = HashMap::new();
        for o in config.overrides {
            if overrides.insert(o.id.clone(), o.clone()).is_some() {
                return Err(CatalogError::Parse(format!(
                    "duplicate override for {}",
                    o.id
                )));
            }
        }
        Ok(Catalog {
            generated: generated
                .models
                .into_iter()
                .map(|m| (m.id.clone(), m))
                .collect(),
            overrides,
            frontier: config.frontier.models.into_iter().collect(),
            fallback: config.fallback.models,
            default_chat_model: config.defaults.chat_model,
            title_model: config.defaults.title_model,
            tiers: config.tiers,
        })
    }

    /// Number of models with catalogue metadata (for diagnostics).
    pub fn catalogue_size(&self) -> usize {
        self.generated.len()
    }

    /// Merges live IDs with metadata. `providers` lists the providers the user can reach
    /// (Mixroute always; direct providers only when they have a key).
    pub fn merge(&self, live: &LiveModels, providers: &[ProviderId]) -> Vec<ModelInfo> {
        let mut out = Vec::new();
        for &provider in providers {
            match live.by_provider.get(&provider) {
                Some(list) => {
                    for m in &list.models {
                        let is_new = live
                            .previous_launch_at
                            .is_some_and(|prev| m.first_seen_at > prev);
                        out.push(self.info(
                            provider,
                            &m.id,
                            m.owned_by.as_deref(),
                            &m.endpoint_types,
                            is_new,
                        ));
                    }
                }
                None if provider == ProviderId::Mixroute => {
                    for id in &self.fallback {
                        out.push(self.info(provider, id, None, &[], false));
                    }
                }
                None => {}
            }
        }
        sort_default(&mut out);
        out
    }

    /// Metadata for a model key even when it isn't in a live list (cost, capabilities).
    pub fn lookup(&self, key: &str) -> Option<ModelInfo> {
        let (provider, id) = parse_model_key(key)?;
        Some(self.info(provider, id, None, &[], false))
    }

    fn info(
        &self,
        provider: ProviderId,
        id: &str,
        owned_by: Option<&str>,
        live_endpoints: &[String],
        is_new: bool,
    ) -> ModelInfo {
        // The generated catalogue describes Mixroute's models only.
        let meta = (provider == ProviderId::Mixroute)
            .then(|| self.generated.get(id))
            .flatten();
        let over = self.overrides.get(id);
        let pick = |o: Option<bool>, g: Option<bool>| o.or(g).unwrap_or(false);
        let caps = ModelCaps {
            vision: pick(
                over.and_then(|o| o.vision),
                meta.and_then(|m| m.capabilities.vision),
            ),
            tools: pick(
                over.and_then(|o| o.tools),
                meta.and_then(|m| m.capabilities.tools),
            ),
            structured_output: pick(
                over.and_then(|o| o.structured_output),
                meta.and_then(|m| m.capabilities.structured_output),
            ),
            reasoning: pick(
                over.and_then(|o| o.reasoning),
                meta.and_then(|m| m.capabilities.reasoning),
            ),
            file_input: pick(
                over.and_then(|o| o.file_input),
                meta.and_then(|m| m.capabilities.file_input),
            ),
        };
        let kind = meta
            .map(|m| m.kind)
            .unwrap_or_else(|| ModelKind::from_id(id));
        let per_call = meta.is_some_and(|m| m.pricing == "per-call");
        let input_price = meta.and_then(|m| m.input_price);
        let output_price = meta.and_then(|m| m.output_price);
        let endpoint_types: Vec<String> = if live_endpoints.is_empty() {
            meta.map(|m| m.endpoints.clone()).unwrap_or_default()
        } else {
            live_endpoints.to_vec()
        };
        let (chat_supported, unavailable_reason) = chat_support(kind, &endpoint_types);
        ModelInfo {
            key: model_key(provider, id),
            id: id.to_string(),
            provider,
            name: over
                .and_then(|o| o.name.clone())
                .or_else(|| meta.map(|m| m.name.clone()))
                .unwrap_or_else(|| id.to_string()),
            vendor: meta
                .and_then(|m| m.vendor.clone())
                .unwrap_or_else(|| vendor_from_owner(provider, id, owned_by)),
            kind,
            input_modalities: meta
                .and_then(|m| m.input_modalities.clone())
                .unwrap_or_default(),
            output_modalities: meta
                .and_then(|m| m.output_modalities.clone())
                .unwrap_or_default(),
            context_window: meta.and_then(|m| m.context_window),
            max_output: meta.and_then(|m| m.max_output),
            pricing: if per_call {
                PricingUnit::PerCall
            } else {
                PricingUnit::PerToken
            },
            input_price,
            output_price,
            cached_input_price: meta.and_then(|m| m.cached_input_price),
            per_call_price: meta.and_then(|m| m.per_call_price),
            tiered_pricing: meta.is_some_and(|m| m.tiered_pricing),
            free: !per_call && input_price == Some(0.0) && output_price == Some(0.0),
            agent_eligible: chat_supported && (caps.structured_output || caps.tools),
            caps,
            frontier: self.frontier.contains(id),
            endpoint_types,
            chat_supported,
            unavailable_reason,
            has_metadata: meta.is_some(),
            is_new,
        }
    }
}

fn endpoint_label(endpoint: &str) -> String {
    match endpoint {
        "anthropic" => "Anthropic Messages".to_string(),
        "gemini" => "Gemini".to_string(),
        "openai-response" => "OpenAI Responses".to_string(),
        "image-generation" => "image generation".to_string(),
        other => other.to_string(),
    }
}

/// Only text-output models reachable through `/chat/completions` can chat in this build.
fn chat_support(kind: ModelKind, endpoints: &[String]) -> (bool, Option<String>) {
    if kind != ModelKind::Chat {
        return (
            false,
            Some(format!(
                "Chat isn't supported for {} models yet.",
                kind.label()
            )),
        );
    }
    if !endpoints.is_empty() && !endpoints.iter().any(|e| e == "openai") {
        let needed = endpoints
            .iter()
            .map(|e| endpoint_label(e))
            .collect::<Vec<_>>()
            .join(" or ");
        return (
            false,
            Some(format!(
                "Needs the {needed} endpoint, which Machi doesn't support yet."
            )),
        );
    }
    (true, None)
}

/// Default order: frontier by output price, then priced models by output price (ties:
/// input price, then name), then unknown prices, then free models.
pub fn sort_default(models: &mut [ModelInfo]) {
    fn group(m: &ModelInfo) -> u8 {
        if m.free {
            3
        } else if m.frontier {
            0
        } else if m.output_price.is_some() {
            1
        } else {
            2
        }
    }
    fn desc(a: Option<f64>, b: Option<f64>) -> Ordering {
        match (a, b) {
            (Some(x), Some(y)) => y.partial_cmp(&x).unwrap_or(Ordering::Equal),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        }
    }
    models.sort_by(|a, b| {
        group(a)
            .cmp(&group(b))
            .then_with(|| desc(a.output_price, b.output_price))
            .then_with(|| desc(a.input_price, b.input_price))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.id.cmp(&b.id))
    });
}

/// Best-effort vendor name for a model without catalogue metadata.
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
        ("glm", "GLM"),
        ("minimax", "Minimax"),
        ("grok", "xAI"),
        ("mistral", "Mistral"),
        ("llama", "Meta"),
    ];
    let tail = lower.rsplit('/').next().unwrap_or(&lower);
    if let Some((_, vendor)) = by_prefix.iter().find(|(p, _)| tail.starts_with(p)) {
        return (*vendor).to_string();
    }
    match owned_by {
        Some(owner) if !owner.is_empty() && provider != ProviderId::Mixroute => owner.to_string(),
        _ => provider.display_name().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::CachedModel;

    const SAMPLE: &str = include_str!("../../../tests/fixtures/providers/models_sample.json");

    fn sample_live(previous_launch_at: Option<Millis>) -> LiveModels {
        let value: serde_json::Value = serde_json::from_str(SAMPLE).unwrap();
        let models = value["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| CachedModel {
                id: m["id"].as_str().unwrap().to_string(),
                owned_by: m["owned_by"].as_str().map(str::to_string),
                endpoint_types: m["supported_endpoint_types"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|e| e.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
                first_seen_at: 500,
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

    fn sample_ids() -> Vec<String> {
        let value: serde_json::Value = serde_json::from_str(SAMPLE).unwrap();
        value["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["id"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn embedded_config_parses() {
        let catalog = Catalog::embedded().unwrap();
        assert_eq!(catalog.default_chat_model, "mixroute:gpt-4.1-nano");
        assert!(catalog.catalogue_size() > 200);
        assert!(catalog.tiers.contains_key("t1"));
        for id in &catalog.frontier {
            assert!(
                catalog.generated.contains_key(id),
                "frontier model {id} is not in the catalogue"
            );
        }
        for id in catalog.overrides.keys() {
            assert!(
                catalog.generated.contains_key(id),
                "override for unknown model {id}"
            );
        }
    }

    #[test]
    fn every_id_from_models_is_listed_even_without_metadata() {
        let catalog = Catalog::embedded().unwrap();
        let models = catalog.merge(&sample_live(None), &[ProviderId::Mixroute]);
        let listed: HashSet<&str> = models.iter().map(|m| m.id.as_str()).collect();
        for id in sample_ids() {
            assert!(
                listed.contains(id.as_str()),
                "{id} missing from the merged list"
            );
        }
        assert_eq!(models.len(), sample_ids().len());
        let unknown = models.iter().find(|m| m.id == "brand-new-model-x").unwrap();
        assert!(!unknown.has_metadata);
        assert_eq!(unknown.input_price, None);
        assert!(!unknown.free);
        assert!(unknown.chat_supported, "unknown text IDs default to chat");
        // Dated snapshots are listed too.
        assert!(listed.contains("gpt-4.1-nano-2025-04-14"));
    }

    #[test]
    fn non_chat_models_are_listed_but_unavailable() {
        let catalog = Catalog::embedded().unwrap();
        let models = catalog.merge(&sample_live(None), &[ProviderId::Mixroute]);
        let image = models
            .iter()
            .find(|m| m.id == "gemini-2.5-flash-image")
            .unwrap();
        assert_eq!(image.kind, ModelKind::Image);
        assert!(!image.chat_supported);
        assert!(
            image
                .unavailable_reason
                .as_deref()
                .unwrap()
                .contains("image models")
        );
        let embedding = models
            .iter()
            .find(|m| m.id == "text-embedding-3-small")
            .unwrap();
        assert_eq!(embedding.kind, ModelKind::Embedding);
        assert!(!embedding.chat_supported);
        let anthropic_only = models.iter().find(|m| m.id == "claude-opus-5-5").unwrap();
        assert!(
            !anthropic_only.chat_supported,
            "sample lists only the anthropic endpoint for it"
        );
        assert!(
            anthropic_only
                .unavailable_reason
                .as_deref()
                .unwrap()
                .contains("Anthropic Messages")
        );
    }

    #[test]
    fn default_order_is_frontier_then_price_then_unknown_then_free() {
        let catalog = Catalog::embedded().unwrap();
        let models = catalog.merge(&sample_live(None), &[ProviderId::Mixroute]);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        // Frontier first, by output price: GPT-6 Astra ($50) before Claude Opus 5.5 ($20).
        assert_eq!(&ids[..2], ["gpt-6-astra", "claude-opus-5-5"]);
        let first_non_frontier = models.iter().position(|m| !m.frontier).unwrap();
        assert!(models[..first_non_frontier].iter().all(|m| m.frontier));
        // Then priced models by output price, high to low.
        let priced: Vec<f64> = models
            .iter()
            .filter(|m| !m.frontier && !m.free)
            .filter_map(|m| m.output_price)
            .collect();
        assert!(priced.windows(2).all(|w| w[0] >= w[1]), "{priced:?}");
        // Unknown prices after priced ones, free models last.
        let unknown_at = ids
            .iter()
            .position(|id| *id == "brand-new-model-x")
            .unwrap();
        let last_priced = models
            .iter()
            .rposition(|m| !m.frontier && !m.free && m.output_price.is_some())
            .unwrap();
        assert!(unknown_at > last_priced);
        assert_eq!(*ids.last().unwrap(), "glm-4-flash");
    }

    #[test]
    fn ties_break_on_input_price_then_name() {
        let catalog = Catalog::embedded().unwrap();
        let mut models: Vec<ModelInfo> = [
            "gpt-6-sol",
            "gpt-6.1-sol",
            "gemini-4-argon",
            "claude-sonnet-5-5",
        ]
        .iter()
        .filter_map(|id| catalog.lookup(&format!("mixroute:{id}")))
        .collect();
        sort_default(&mut models);
        let names: Vec<&str> = models.iter().map(|m| m.name.as_str()).collect();
        let mut sorted = names.clone();
        sorted.sort_by_key(|n| n.to_lowercase());
        assert_eq!(names, sorted, "equal $2/$10 prices fall back to name order");
    }

    #[test]
    fn free_only_when_both_prices_are_confirmed_zero() {
        let catalog = Catalog::embedded().unwrap();
        let glm = catalog.lookup("mixroute:glm-4-flash").unwrap();
        assert!(glm.free);
        assert_eq!(glm.cost_usd(1000, 1000), Some(0.0));
        let unknown = catalog.lookup("mixroute:never-heard-of-it").unwrap();
        assert!(!unknown.free);
        assert_eq!(unknown.cost_usd(1000, 1000), None);
        let per_call = catalog.lookup("mixroute:sora-2").unwrap();
        assert_eq!(per_call.pricing, PricingUnit::PerCall);
        assert!(!per_call.free);
        assert_eq!(per_call.per_call_price, Some(0.3));
    }

    #[test]
    fn overrides_win_over_the_catalogue() {
        let catalog = Catalog::embedded().unwrap();
        let nano = catalog.lookup("mixroute:gpt-4.1-nano").unwrap();
        assert!(
            !nano.caps.vision,
            "image parts are dropped for gpt-4.1-nano via Mixroute (D12)"
        );
        assert!(!nano.caps.structured_output);
        assert_eq!(nano.input_price, Some(0.1));
        let cost = nano.cost_usd(1_000_000, 1_000_000).unwrap();
        assert!((cost - 0.3).abs() < 1e-9);
    }

    #[test]
    fn fallback_list_is_used_before_any_live_list() {
        let catalog = Catalog::embedded().unwrap();
        let models = catalog.merge(&LiveModels::default(), &[ProviderId::Mixroute]);
        assert_eq!(models.len(), catalog.fallback.len());
        assert!(models.iter().any(|m| m.id == "gpt-4.1-nano"));
    }

    #[test]
    fn new_badge_needs_a_previous_launch() {
        let catalog = Catalog::embedded().unwrap();
        assert!(
            catalog
                .merge(&sample_live(None), &[ProviderId::Mixroute])
                .iter()
                .all(|m| !m.is_new)
        );
        assert!(
            catalog
                .merge(&sample_live(Some(100)), &[ProviderId::Mixroute])
                .iter()
                .all(|m| m.is_new)
        );
        assert!(
            catalog
                .merge(&sample_live(Some(900)), &[ProviderId::Mixroute])
                .iter()
                .all(|m| !m.is_new)
        );
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
    fn invalid_config_is_rejected() {
        let generated = r#"{"models":[]}"#;
        assert!(
            Catalog::parse(
                "[defaults]\nchat_model='nope'\ntitle_model='mixroute:a'\n",
                generated
            )
            .is_err()
        );
        let dup = "[defaults]\nchat_model='mixroute:a'\ntitle_model='mixroute:a'\n[[overrides]]\nid='a'\n[[overrides]]\nid='a'\n";
        assert!(Catalog::parse(dup, generated).is_err());
        assert!(
            Catalog::parse(
                "[defaults]\nchat_model='mixroute:a'\ntitle_model='mixroute:a'\n",
                "{"
            )
            .is_err()
        );
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
