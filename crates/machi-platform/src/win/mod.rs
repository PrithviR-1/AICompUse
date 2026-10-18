//! Windows platform adapter. Phase 0: platform facts only.

use crate::{OsKind, PlatformFacts, PlatformInfo};

pub struct WinPlatform;

impl PlatformFacts for WinPlatform {
    fn info(&self) -> PlatformInfo {
        PlatformInfo {
            os: OsKind::Windows,
            modifier_label: "Ctrl".to_string(),
            arch: std::env::consts::ARCH.to_string(),
        }
    }
}
