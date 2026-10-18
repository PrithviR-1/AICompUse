//! The one OpenAI-compatible adapter (§1.3): Mixroute and every direct provider are this
//! adapter with a different base URL and key. Handles streaming over SSE, cancellation,
//! and 429 retries with exponential backoff + jitter (max 3) before a typed
//! `RateLimited` error.

use std::time::Duration;

use futures_util::StreamExt;
use futures_util::future::BoxFuture;
use reqwest::{RequestBuilder, Response, StatusCode};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use super::sse::SseParser;
use super::types::{ChatRequest, ContentPart, RemoteModel, StreamEvent, StreamOutcome, Usage};
use super::{ChatProvider, ProviderError, ProviderId};
use crate::secrets::SecretString;

/// Backoff for 429 responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay: Duration::from_millis(1000),
            max_delay: Duration::from_secs(20),
        }
    }
}

impl RetryPolicy {
    /// Delay before retry `attempt` (0-based): base·2^attempt plus up to 50% jitter,
    /// or the server's Retry-After when given, capped at `max_delay`.
    fn delay(&self, attempt: u32, retry_after: Option<Duration>) -> Duration {
        if let Some(wait) = retry_after {
            return wait.min(self.max_delay);
        }
        let exp = self.base_delay.saturating_mul(1u32 << attempt.min(16));
        let jitter_ms = exp.as_millis() as u64 / 2;
        let jitter = if jitter_ms == 0 {
            0
        } else {
            rand::random_range(0..=jitter_ms)
        };
        (exp + Duration::from_millis(jitter)).min(self.max_delay)
    }
}

pub struct OpenAiCompatible {
    provider: ProviderId,
    base_url: String,
    key: SecretString,
    http: reqwest::Client,
    retry: RetryPolicy,
}

impl OpenAiCompatible {
    pub fn new(
        provider: ProviderId,
        base_url: &str,
        key: SecretString,
    ) -> Result<Self, ProviderError> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            // Idle timeout between reads; streams may run for minutes overall.
            .read_timeout(Duration::from_secs(120))
            .user_agent(concat!("Machi/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| ProviderError::Network(e.to_string()))?;
        Ok(Self {
            provider,
            base_url: base_url.trim_end_matches('/').to_string(),
            key,
            http,
            retry: RetryPolicy::default(),
        })
    }

    pub fn with_retry(mut self, retry: RetryPolicy) -> Self {
        self.retry = retry;
        self
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }

    /// Sends a request, retrying 429s per the policy. Delays are cancellable.
    async fn send(
        &self,
        build: impl Fn() -> RequestBuilder,
        cancel: &CancellationToken,
    ) -> Result<Response, ProviderError> {
        let mut attempt = 0;
        loop {
            let request = build().bearer_auth(self.key.expose());
            let response = tokio::select! {
                _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
                r = request.send() => r.map_err(map_reqwest_error)?,
            };
            let status = response.status();
            if status.is_success() {
                return Ok(response);
            }
            let retry_after = parse_retry_after(&response);
            if status == StatusCode::TOO_MANY_REQUESTS && attempt < self.retry.max_retries {
                let wait = self.retry.delay(attempt, retry_after);
                tracing::info!(
                    provider = self.provider.slug(),
                    attempt,
                    wait_ms = wait.as_millis() as u64,
                    "rate limited; backing off"
                );
                tokio::select! {
                    _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
                    _ = tokio::time::sleep(wait) => {}
                }
                attempt += 1;
                continue;
            }
            let body = response.text().await.unwrap_or_default();
            return Err(map_status(status, &body, retry_after));
        }
    }

    async fn list_models_impl(&self) -> Result<Vec<RemoteModel>, ProviderError> {
        let cancel = CancellationToken::new();
        let response = self
            .send(|| self.http.get(self.url("models")), &cancel)
            .await?;
        let body: Value = response
            .json()
            .await
            .map_err(|e| ProviderError::Decode(e.to_string()))?;
        parse_models(&body)
    }

    async fn stream_chat_impl(
        &self,
        request: &ChatRequest,
        on_event: &mut (dyn FnMut(StreamEvent) + Send),
        cancel: &CancellationToken,
    ) -> Result<StreamOutcome, ProviderError> {
        let body = request_body(request);
        let response = self
            .send(
                || self.http.post(self.url("chat/completions")).json(&body),
                cancel,
            )
            .await?;

        let mut stream = response.bytes_stream();
        let mut parser = SseParser::new();
        let mut outcome = StreamOutcome {
            finish_reason: None,
            usage: None,
        };
        loop {
            let next = tokio::select! {
                _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
                chunk = stream.next() => chunk,
            };
            let ended = next.is_none();
            let payloads = match next {
                Some(Ok(bytes)) => parser.push(&bytes),
                Some(Err(err)) => return Err(map_reqwest_error(err)),
                None => parser.finish(),
            };
            for payload in payloads {
                if payload.trim() == "[DONE]" {
                    return Ok(outcome);
                }
                apply_chunk(&payload, &mut outcome, on_event)?;
            }
            if ended {
                return Ok(outcome);
            }
        }
    }
}

impl ChatProvider for OpenAiCompatible {
    fn id(&self) -> ProviderId {
        self.provider
    }

    fn list_models(&self) -> BoxFuture<'_, Result<Vec<RemoteModel>, ProviderError>> {
        Box::pin(self.list_models_impl())
    }

    fn stream_chat<'a>(
        &'a self,
        request: &'a ChatRequest,
        on_event: &'a mut (dyn FnMut(StreamEvent) + Send),
        cancel: &'a CancellationToken,
    ) -> BoxFuture<'a, Result<StreamOutcome, ProviderError>> {
        Box::pin(self.stream_chat_impl(request, on_event, cancel))
    }
}

/// OpenAI reasoning models reject `max_tokens` and custom temperatures.
fn is_openai_reasoning_model(model: &str) -> bool {
    let tail = model.rsplit('/').next().unwrap_or(model);
    tail.starts_with("gpt-5")
        || tail.starts_with("o1")
        || tail.starts_with("o3")
        || tail.starts_with("o4")
}

/// Builds the plain OpenAI wire-format request body.
pub(crate) fn request_body(request: &ChatRequest) -> Value {
    let messages: Vec<Value> = request
        .messages
        .iter()
        .map(|m| {
            let content = match m.content.as_slice() {
                [ContentPart::Text(text)] => Value::String(text.clone()),
                parts => Value::Array(
                    parts
                        .iter()
                        .map(|p| match p {
                            ContentPart::Text(text) => json!({"type": "text", "text": text}),
                            ContentPart::ImageUrl(url) => {
                                json!({"type": "image_url", "image_url": {"url": url}})
                            }
                        })
                        .collect(),
                ),
            };
            json!({"role": m.role.as_str(), "content": content})
        })
        .collect();

    let mut body = json!({
        "model": request.model,
        "messages": messages,
        "stream": true,
        "stream_options": {"include_usage": true},
    });
    let reasoning_model = is_openai_reasoning_model(&request.model);
    if let Some(t) = request.temperature
        && !reasoning_model
    {
        body["temperature"] = json!(t);
    }
    if let Some(max) = request.max_tokens {
        let field = if reasoning_model {
            "max_completion_tokens"
        } else {
            "max_tokens"
        };
        body[field] = json!(max);
    }
    if let Some(effort) = request.reasoning_effort {
        body["reasoning_effort"] = json!(effort.as_str());
    }
    body
}

/// Applies one streamed JSON chunk: text deltas, finish reason, usage, inline errors.
fn apply_chunk(
    payload: &str,
    outcome: &mut StreamOutcome,
    on_event: &mut (dyn FnMut(StreamEvent) + Send),
) -> Result<(), ProviderError> {
    let chunk: Value =
        serde_json::from_str(payload).map_err(|e| ProviderError::Decode(e.to_string()))?;
    if let Some(error) = chunk.get("error") {
        let message = error_message(error).unwrap_or_else(|| error.to_string());
        let status = error
            .get("code")
            .and_then(Value::as_u64)
            .and_then(|c| u16::try_from(c).ok())
            .unwrap_or(500);
        return Err(map_status(
            StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            &json!({"error": {"message": message}}).to_string(),
            None,
        ));
    }
    if let Some(choice) = chunk.get("choices").and_then(|c| c.get(0)) {
        if let Some(text) = choice
            .get("delta")
            .and_then(|d| d.get("content"))
            .and_then(Value::as_str)
            && !text.is_empty()
        {
            on_event(StreamEvent::Delta(text.to_string()));
        }
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            outcome.finish_reason = Some(reason.to_string());
        }
    }
    if let Some(usage) = chunk.get("usage").filter(|u| !u.is_null()) {
        let get = |k: &str| {
            usage
                .get(k)
                .and_then(Value::as_u64)
                .and_then(|v| u32::try_from(v).ok())
                .unwrap_or(0)
        };
        let usage = Usage {
            prompt_tokens: get("prompt_tokens"),
            completion_tokens: get("completion_tokens"),
        };
        outcome.usage = Some(usage);
        on_event(StreamEvent::Usage(usage));
    }
    Ok(())
}

fn parse_models(body: &Value) -> Result<Vec<RemoteModel>, ProviderError> {
    let data = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| ProviderError::Decode("missing `data` array".into()))?;
    Ok(data
        .iter()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?.to_string();
            let owned_by = m
                .get("owned_by")
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(RemoteModel { id, owned_by })
        })
        .collect())
}

fn parse_retry_after(response: &Response) -> Option<Duration> {
    let value = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?;
    let seconds: f64 = value.trim().parse().ok()?;
    (seconds.is_finite() && seconds >= 0.0)
        .then(|| Duration::from_millis((seconds * 1000.0) as u64))
}

fn error_message(error: &Value) -> Option<String> {
    match error {
        Value::String(s) => Some(s.clone()),
        Value::Object(_) => error
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string),
        _ => None,
    }
}

/// Extracts a readable message from an error body (JSON or plain text).
fn body_message(body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        if let Some(msg) = value.get("error").and_then(error_message) {
            return msg;
        }
        if let Some(msg) = value.get("message").and_then(Value::as_str) {
            return msg.to_string();
        }
    }
    body.chars().take(300).collect()
}

fn looks_like_model_unavailable(message: &str) -> bool {
    let m = message.to_lowercase();
    m.contains("model")
        && [
            "not found",
            "does not exist",
            "not exist",
            "no available",
            "not available",
            "unsupported model",
            "invalid model",
        ]
        .iter()
        .any(|needle| m.contains(needle))
}

pub(crate) fn map_status(
    status: StatusCode,
    body: &str,
    retry_after: Option<Duration>,
) -> ProviderError {
    let message = body_message(body);
    match status.as_u16() {
        401 | 403 => ProviderError::Unauthorized {
            status: status.as_u16(),
        },
        429 => ProviderError::RateLimited {
            retry_after_ms: retry_after.map(|d| u32::try_from(d.as_millis()).unwrap_or(u32::MAX)),
        },
        404 => ProviderError::ModelUnavailable(message),
        _ if looks_like_model_unavailable(&message) => ProviderError::ModelUnavailable(message),
        400..=499 => ProviderError::BadRequest {
            status: status.as_u16(),
            message,
        },
        _ => ProviderError::Upstream {
            status: status.as_u16(),
            message,
        },
    }
}

fn map_reqwest_error(err: reqwest::Error) -> ProviderError {
    if err.is_decode() {
        ProviderError::Decode(err.to_string())
    } else {
        // Never include the URL query or headers; reqwest's Display has neither the key.
        ProviderError::Network(err.without_url().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::test_server::{Reply, TestServer};
    use crate::providers::types::{ChatMessage, ChatRole};
    use crate::types::ReasoningEffort;

    const STREAM_BASIC: &str =
        include_str!("../../../../tests/fixtures/providers/stream_basic.sse");
    const STREAM_INLINE_ERROR: &str =
        include_str!("../../../../tests/fixtures/providers/stream_inline_error.sse");
    const MODELS_LIST: &str = include_str!("../../../../tests/fixtures/providers/models_list.json");

    fn fast_retry() -> RetryPolicy {
        RetryPolicy {
            max_retries: 3,
            base_delay: Duration::from_millis(1),
            max_delay: Duration::from_millis(5),
        }
    }

    fn adapter(server: &TestServer) -> OpenAiCompatible {
        OpenAiCompatible::new(
            ProviderId::Mixroute,
            &server.base_url(),
            SecretString::new("test-key"),
        )
        .unwrap()
        .with_retry(fast_retry())
    }

    fn hello() -> ChatRequest {
        ChatRequest::new(
            "gpt-4.1-nano",
            vec![ChatMessage::text(ChatRole::User, "Hello")],
        )
    }

    async fn run(
        adapter: &OpenAiCompatible,
        request: &ChatRequest,
    ) -> (Result<StreamOutcome, ProviderError>, String) {
        let mut text = String::new();
        let cancel = CancellationToken::new();
        let mut on_event = |e: StreamEvent| {
            if let StreamEvent::Delta(d) = e {
                text.push_str(&d);
            }
        };
        let result = adapter.stream_chat(request, &mut on_event, &cancel).await;
        (result, text)
    }

    #[tokio::test]
    async fn streams_recorded_completion_with_usage() {
        let server = TestServer::start(vec![Reply::sse(STREAM_BASIC)]).await;
        let (result, text) = run(&adapter(&server), &hello()).await;
        let outcome = result.unwrap();
        assert_eq!(text, "Hello! How can I help you today?");
        assert_eq!(outcome.finish_reason.as_deref(), Some("stop"));
        assert_eq!(
            outcome.usage,
            Some(Usage {
                prompt_tokens: 9,
                completion_tokens: 10
            })
        );

        let requests = server.requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "POST");
        assert_eq!(requests[0].path, "/v1/chat/completions");
        assert_eq!(
            requests[0].authorization.as_deref(),
            Some("Bearer test-key")
        );
        let body: Value = serde_json::from_str(&requests[0].body).unwrap();
        assert_eq!(body["stream"], true);
        assert_eq!(body["stream_options"]["include_usage"], true);
        assert_eq!(body["messages"][0]["content"], "Hello");
    }

    #[tokio::test]
    async fn retries_429_then_succeeds() {
        let server = TestServer::start(vec![
            Reply::status(429, r#"{"error":{"message":"slow down"}}"#),
            Reply::status(429, r#"{"error":{"message":"slow down"}}"#),
            Reply::sse(STREAM_BASIC),
        ])
        .await;
        let (result, text) = run(&adapter(&server), &hello()).await;
        assert!(result.is_ok());
        assert!(!text.is_empty());
        assert_eq!(server.requests().len(), 3);
    }

    #[tokio::test]
    async fn gives_up_after_three_retries_with_rate_limited() {
        let replies = (0..4)
            .map(|_| Reply::status(429, "{}").with_header("Retry-After", "0.002"))
            .collect();
        let server = TestServer::start(replies).await;
        let (result, _) = run(&adapter(&server), &hello()).await;
        assert_eq!(
            result,
            Err(ProviderError::RateLimited {
                retry_after_ms: Some(2)
            })
        );
        assert_eq!(server.requests().len(), 4, "1 attempt + 3 retries");
    }

    #[tokio::test]
    async fn maps_auth_and_model_errors() {
        let server = TestServer::start(vec![
            Reply::status(
                401,
                r#"{"error":{"code":"","message":"Invalid token","type":"mixroute_error"}}"#,
            ),
            Reply::status(400, r#"{"error":{"message":"model gpt-x does not exist"}}"#),
            Reply::status(503, "upstream overloaded"),
            Reply::status(422, r#"{"error":{"message":"temperature out of range"}}"#),
        ])
        .await;
        let a = adapter(&server);
        assert_eq!(
            run(&a, &hello()).await.0,
            Err(ProviderError::Unauthorized { status: 401 })
        );
        assert!(matches!(
            run(&a, &hello()).await.0,
            Err(ProviderError::ModelUnavailable(_))
        ));
        assert_eq!(
            run(&a, &hello()).await.0,
            Err(ProviderError::Upstream {
                status: 503,
                message: "upstream overloaded".into()
            })
        );
        assert!(matches!(
            run(&a, &hello()).await.0,
            Err(ProviderError::BadRequest { status: 422, .. })
        ));
    }

    #[tokio::test]
    async fn inline_stream_errors_surface_after_partial_text() {
        let server = TestServer::start(vec![Reply::sse(STREAM_INLINE_ERROR)]).await;
        let (result, text) = run(&adapter(&server), &hello()).await;
        assert_eq!(text, "Partial");
        assert!(matches!(result, Err(ProviderError::Upstream { .. })));
    }

    #[tokio::test]
    async fn cancellation_stops_a_slow_stream() {
        let server = TestServer::start(vec![Reply::slow_sse(
            STREAM_BASIC,
            Duration::from_millis(200),
        )])
        .await;
        let a = adapter(&server);
        let cancel = CancellationToken::new();
        let request = hello();
        let canceller = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(250)).await;
            canceller.cancel();
        });
        let mut deltas = 0;
        let mut on_event = |e: StreamEvent| {
            if matches!(e, StreamEvent::Delta(_)) {
                deltas += 1;
            }
        };
        let started = std::time::Instant::now();
        let result = a.stream_chat(&request, &mut on_event, &cancel).await;
        assert_eq!(result, Err(ProviderError::Cancelled));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(deltas < 8, "stopped before the full answer");
    }

    #[tokio::test]
    async fn lists_models_from_recorded_response() {
        let server = TestServer::start(vec![Reply::json(MODELS_LIST)]).await;
        let models = adapter(&server).list_models().await.unwrap();
        assert_eq!(models.len(), 3);
        assert_eq!(
            models[0],
            RemoteModel {
                id: "gpt-4.1-nano".into(),
                owned_by: Some("openai".into())
            }
        );
        assert_eq!(server.requests()[0].method, "GET");
        assert_eq!(server.requests()[0].path, "/v1/models");
    }

    #[test]
    fn request_body_uses_parts_for_images_and_quirks_for_reasoning_models() {
        let mut request = ChatRequest::new(
            "gpt-5",
            vec![ChatMessage {
                role: ChatRole::User,
                content: vec![
                    ContentPart::Text("What is this?".into()),
                    ContentPart::ImageUrl("data:image/png;base64,AAA".into()),
                ],
            }],
        );
        request.temperature = Some(0.3);
        request.max_tokens = Some(256);
        request.reasoning_effort = Some(ReasoningEffort::Low);
        let body = request_body(&request);
        assert_eq!(
            body["messages"][0]["content"][1]["image_url"]["url"],
            "data:image/png;base64,AAA"
        );
        assert!(body.get("temperature").is_none());
        assert_eq!(body["max_completion_tokens"], 256);
        assert_eq!(body["reasoning_effort"], "low");

        request.model = "gpt-4.1-nano".into();
        let body = request_body(&request);
        assert_eq!(body["temperature"], json!(0.3_f32));
        assert_eq!(body["max_tokens"], 256);
    }

    #[test]
    fn backoff_grows_and_respects_retry_after() {
        let policy = RetryPolicy::default();
        let first = policy.delay(0, None);
        let third = policy.delay(2, None);
        assert!(first >= Duration::from_millis(1000) && first <= Duration::from_millis(1500));
        assert!(third >= Duration::from_millis(4000) && third <= Duration::from_millis(6000));
        assert_eq!(
            policy.delay(0, Some(Duration::from_secs(60))),
            Duration::from_secs(20)
        );
    }
}
