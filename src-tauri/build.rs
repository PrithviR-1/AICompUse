//! Build script: Tauri code generation, plus the Windows application manifest for every
//! linked target.
//!
//! tauri-build embeds its Common Controls v6 manifest into the app binary only. Examples and
//! test harnesses that link Tauri then load Common Controls v5 and Windows refuses to start
//! them (STATUS_ENTRYPOINT_NOT_FOUND, 0xc0000139). So tauri-build's manifest is turned off and
//! the same manifest is embedded through the MSVC linker for all targets instead.

use std::path::PathBuf;

fn main() {
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    if let Err(err) =
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
    {
        eprintln!("tauri-build failed: {err:#}");
        std::process::exit(1);
    }

    // Decide by the target being built, not the host running this script.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        // rustc-link-arg applies to bins, examples and tests alike.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
}
