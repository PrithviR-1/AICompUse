//! Model providers (§1.3 `providers`): one OpenAI-compatible adapter configured per
//! provider with a base URL and key, used for both chat and (later) computer use.

mod error;
mod id;

pub use error::ProviderError;
pub use id::ProviderId;
