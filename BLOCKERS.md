# BLOCKERS

Things only the user can provide or do. HARD blockers stop the build; SOFT blockers only skip what depends on them.

## B1 — SOFT — Low disk space
- **What:** `df -h $HOME` shows 12 GiB free; §14.2 step 3 asks for at least 15 GB.
- **Why it matters:** Rust `target/` for a Tauri app plus a release build and the Playwright browser can use several GB. Builds may fail late if space runs out.
- **Update:** the disk briefly fell to 1.3 GiB free during the build. Dependency debug info was turned off in the dev profile and the mobile crate types were dropped (D14), which cut `target/` from 6.6 GB to 1.4 GB (≈ 6.4 GiB free afterwards). The release build (`pnpm tauri build`) needs roughly another 1.5–2 GB.
- **What to do:** free a few GB (e.g. empty the Trash, remove old Xcode simulators/derived data in `~/Library/Developer`). Work continues meanwhile with a single shared `target/` directory.

## B2 — SOFT — No GitHub remote, so CI cannot run
- **What:** `git remote get-url origin` fails. The repository is local only.
- **Why it matters:** the Phase 0 exit criterion "CI is green on both OSes" can only be checked on GitHub Actions (windows-latest + macos-latest). The workflow file is written and every step it runs is also run locally on macOS.
- **What to do:** create a GitHub repository, then `git remote add origin <url> && git push -u origin main`, and check the Actions tab.

## B3 — SOFT — Windows build and hands-on check
- **What:** the Windows code paths (`machi-platform::win`, the Windows keychain store via `keyring`, SChannel TLS, the Tauri Windows bundle) compile only in CI on `windows-latest`, which can't run until B2 is resolved. Nothing has been run on Windows.
- **Why it matters:** §13.2 item 6 requires hands-on verification on the other OS; the exit criterion "CI is green on both OSes" depends on it.
- **What to do:** after pushing (B2), check the Windows job in GitHub Actions, then run the built app on a Windows 10+ machine once: add the Mixroute key, send a message, stop it, and restart the app to confirm the key persists.

## B4 — SOFT — Clicking through the desktop app
- **What:** the UI flows are verified in Chromium against the mock backend (28 Playwright tests) and the backend flows live against Mixroute (`cargo run --example live_chat`), but nobody has clicked through the packaged macOS app itself (WebDriver for Tauri isn't available on macOS).
- **What to do:** open `target/release/bundle/macos/Machi.app` and try a chat, stop, compare, an image on GPT-4.1, rename/pin/delete in the Chats panel, and export (the file lands in Downloads).

## B5 — SOFT — Local DMG packaging
- **What:** the DMG step of `pnpm tauri build` needs the terminal to control Finder (Automation permission); it timed out here. `Machi.app` itself builds fine (`pnpm tauri build --bundles app`).
- **What to do (optional):** allow your terminal under System Settings → Privacy & Security → Automation → Finder, then run `pnpm tauri build`; or take the DMG from CI once B2 is resolved.
