//! Tauri command handlers. Each is a thin adapter over `machi-core`.

use machi_platform::PlatformInfo;

/// Facts about the host OS that the UI needs (shortcut labels).
#[tauri::command]
#[specta::specta]
pub fn platform_info() -> PlatformInfo {
    machi_platform::current().info()
}
