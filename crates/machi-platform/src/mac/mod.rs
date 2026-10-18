//! macOS platform adapter. Phase 0: platform facts only.

use crate::{OsKind, PlatformFacts, PlatformInfo};

pub struct MacPlatform;

impl PlatformFacts for MacPlatform {
    fn info(&self) -> PlatformInfo {
        PlatformInfo {
            os: OsKind::MacOs,
            modifier_label: "⌘".to_string(),
            arch: std::env::consts::ARCH.to_string(),
        }
    }
}
