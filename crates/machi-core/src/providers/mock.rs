//! Scripted provider and factory for core tests: replays canned stream events and
//! records every request it receives. Never touches the network.

// Shared test helpers: not every test module uses every script constructor.
#![allow(dead_code)]

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::BoxFuture;
use tokio_util::sync::CancellationToken;

use super::types::{ChatRequest, RemoteModel, StreamEvent, StreamOutcome, Usage};
use super::{ChatProvider, ProviderError, ProviderFactory, ProviderId};
use crate::secrets::SecretString;

/// One scripted completion: deltas (with an optional pause before each) and a result.
#[derive(Clone)]
pub struct Script {
    pub deltas: Vec<String>,
    pub delay: Duration,
    pub usage: Option<Usage>,
    pub result: Result<(), ProviderError>,
}

impl Script {
    pub fn reply(text: &str) -> Self {
        Self {
            deltas: text.split_inclusive(' ').map(str::to_string).collect(),
            delay: Duration::ZERO,
            usage: Some(Usage {
                prompt_tokens: 10,
                completion_tokens: 5,
            }),
            result: Ok(()),
        }
    }

    pub fn slow(text: &str, delay: Duration) -> Self {
        Self {
            delay,
            ..Self::reply(text)
        }
    }

    pub fn fail(err: ProviderError) -> Self {
        Self {
            deltas: vec![],
            delay: Duration::ZERO,
            usage: None,
            result: Err(err),
        }
    }

    pub fn partial_then_fail(text: &str, err: ProviderError) -> Self {
        Self {
            usage: None,
            result: Err(err),
            ..Self::reply(text)
        }
    }
}

pub struct ScriptedProvider {
    id: ProviderId,
    models: Mutex<Result<Vec<RemoteModel>, ProviderError>>,
    scripts: Mutex<VecDeque<Script>>,
    /// Fallback when the queue is empty.
    default_script: Script,
    requests: Mutex<Vec<ChatRequest>>,
    model_calls: Mutex<u32>,
}

impl ScriptedProvider {
    pub fn new(id: ProviderId) -> Self {
        Self {
            id,
            models: Mutex::new(Ok(vec![])),
            scripts: Mutex::new(VecDeque::new()),
            default_script: Script::reply("ok"),
            requests: Mutex::new(vec![]),
            model_calls: Mutex::new(0),
        }
    }

    pub fn with_models(self, ids: &[&str]) -> Self {
        *self.models.lock().expect("lock") = Ok(ids
            .iter()
            .map(|id| RemoteModel {
                id: id.to_string(),
                owned_by: Some("openai".into()),
                endpoint_types: vec!["openai".into()],
            })
            .collect());
        self
    }

    pub fn set_models_result(&self, result: Result<Vec<RemoteModel>, ProviderError>) {
        *self.models.lock().expect("lock") = result;
    }

    pub fn push(&self, script: Script) {
        self.scripts.lock().expect("lock").push_back(script);
    }

    pub fn requests(&self) -> Vec<ChatRequest> {
        self.requests.lock().expect("lock").clone()
    }

    pub fn model_calls(&self) -> u32 {
        *self.model_calls.lock().expect("lock")
    }
}

impl ChatProvider for ScriptedProvider {
    fn id(&self) -> ProviderId {
        self.id
    }

    fn list_models(&self) -> BoxFuture<'_, Result<Vec<RemoteModel>, ProviderError>> {
        *self.model_calls.lock().expect("lock") += 1;
        let result = self.models.lock().expect("lock").clone();
        Box::pin(async move { result })
    }

    fn verify_key(&self) -> BoxFuture<'_, Result<(), ProviderError>> {
        let result = self.models.lock().expect("lock").clone().map(|_| ());
        Box::pin(async move { result })
    }

    fn stream_chat<'a>(
        &'a self,
        request: &'a ChatRequest,
        on_event: &'a mut (dyn FnMut(StreamEvent) + Send),
        cancel: &'a CancellationToken,
    ) -> BoxFuture<'a, Result<StreamOutcome, ProviderError>> {
        self.requests.lock().expect("lock").push(request.clone());
        let script = self
            .scripts
            .lock()
            .expect("lock")
            .pop_front()
            .unwrap_or_else(|| self.default_script.clone());
        Box::pin(async move {
            for delta in script.deltas {
                if !script.delay.is_zero() {
                    tokio::select! {
                        _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
                        _ = tokio::time::sleep(script.delay) => {}
                    }
                }
                if cancel.is_cancelled() {
                    return Err(ProviderError::Cancelled);
                }
                on_event(StreamEvent::Delta(delta));
            }
            if let Some(usage) = script.usage {
                on_event(StreamEvent::Usage(usage));
            }
            script.result.map(|()| StreamOutcome {
                finish_reason: Some("stop".into()),
                usage: script.usage,
            })
        })
    }
}

#[derive(Default)]
pub struct MockFactory {
    providers: HashMap<ProviderId, Arc<ScriptedProvider>>,
}

impl MockFactory {
    pub fn with(mut self, provider: Arc<ScriptedProvider>) -> Self {
        self.providers.insert(provider.id, provider);
        self
    }
}

impl ProviderFactory for MockFactory {
    fn provider(&self, id: ProviderId) -> Result<Arc<dyn ChatProvider>, ProviderError> {
        self.providers
            .get(&id)
            .map(|p| p.clone() as Arc<dyn ChatProvider>)
            .ok_or(ProviderError::MissingKey(id))
    }

    fn provider_with_key(
        &self,
        id: ProviderId,
        _key: SecretString,
    ) -> Result<Arc<dyn ChatProvider>, ProviderError> {
        self.provider(id)
    }

    fn reachable(&self) -> Vec<ProviderId> {
        let mut ids: Vec<_> = ProviderId::ALL
            .into_iter()
            .filter(|id| *id == ProviderId::Mixroute || self.providers.contains_key(id))
            .collect();
        ids.dedup();
        ids
    }
}
