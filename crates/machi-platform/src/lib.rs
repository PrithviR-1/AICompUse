//! Machi platform adapters (§1.4).
//!
//! Each supported OS has its own module (`mac`, `win`) compiled only on that OS, plus a
//! `mock` module used by tests. Phase 0 only needs basic platform facts for the chat UI
//! (which OS we run on and how to label keyboard shortcuts). Accessibility, capture and
//! input adapters are added behind traits in Phase A.

use serde::Serialize;
use specta::Type;

#[cfg(target_os = "macos")]
mod mac;
pub mod mock;
#[cfg(target_os = "windows")]
mod win;

/// The operating system family Machi is running on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum OsKind {
    MacOs,
    Windows,
    Other,
}

/// Facts about the host platform that the UI needs to render correctly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: OsKind,
    /// Label for the primary shortcut modifier: "⌘" on macOS, "Ctrl" elsewhere.
    pub modifier_label: String,
    /// CPU architecture as reported by Rust (`x86_64`, `aarch64`, …).
    pub arch: String,
}

/// Source of platform facts. Implemented per OS and by the mock adapter.
pub trait PlatformFacts {
    fn info(&self) -> PlatformInfo;
}

/// Returns the platform adapter for the OS this binary was compiled for.
pub fn current() -> Box<dyn PlatformFacts + Send + Sync> {
    #[cfg(target_os = "macos")]
    {
        Box::new(mac::MacPlatform)
    }
    #[cfg(target_os = "windows")]
    {
        Box::new(win::WinPlatform)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Box::new(mock::MockPlatform::new(OsKind::Other))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_platform_reports_this_os() {
        let info = current().info();
        #[cfg(target_os = "macos")]
        assert_eq!(info.os, OsKind::MacOs);
        #[cfg(target_os = "windows")]
        assert_eq!(info.os, OsKind::Windows);
        assert_eq!(info.arch, std::env::consts::ARCH);
        assert!(!info.modifier_label.is_empty());
    }
}
