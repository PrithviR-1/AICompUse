//! Machi desktop binary entry point; all wiring lives in `machi_lib`.

// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    machi_lib::run()
}
