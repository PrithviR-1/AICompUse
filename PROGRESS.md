# PROGRESS — Phase 0 (desktop app shell + chat, no computer use)

## Status when the session paused (2026-10-18) — Phase 0 NOT complete yet
Done and committed: bootstrap, scaffold/CI, secrets, store, providers (+ live smoke test), chat service, 28 Tauri commands, full UI (§15 design system, gallery, shell, home, chat, picker, compare, Models, Settings, search), 97 Rust tests, 118 Vitest tests, 28 Playwright tests (all passing), screenshots in `docs/screenshots/`.

Next steps, in order:
1. ~~6.3 visual review loop~~ done (two rounds; list empty).
2. ~~6.2 §11.12 checks~~ done (contrast test, token check, 200-message virtualization test, denylist and keyboard e2e all green).
3. ~~7.1 live verification~~ done (`cargo run --example live_chat`, all checks passed).
4. ~~7.2 release build~~ done (`Machi.app` built and launched).
5. **7.3:** check every exit criterion, then write the final summary here.


Work order follows §12 Phase 0 and §15.12. Each box is ticked only after its checks pass and it is committed.

## Shell prefix used for every command
```
source "$HOME/.cargo/env" 2>/dev/null; export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; export PATH="$HOME/.local/bin:$PATH";
```

## Bootstrap (§14)
| Step | Result |
|---|---|
| 1. macOS version | 14.6.1 (x86_64) — OK |
| 2. Command Line Tools | Xcode at /Applications/Xcode.app, git 2.39.5 — OK |
| 3. Disk space | 12 GiB free — below 15 GB, SOFT blocker B1 |
| 4. Rust | installed via rustup: rustc/cargo 1.99.1, rustfmt + clippy, x86_64-apple-darwin — OK |
| 5. Node.js | v24.14.0 already installed system-wide at /usr/local/bin (≥ 20) — OK, nvm not needed |
| 6. pnpm | `corepack enable` failed (permission denied, system Node); fallback `npm install -g pnpm --prefix ~/.local` → pnpm 12.14.0 — OK |
| 7. Mixroute key | `grep -c '^MIXROUTE_API_KEY=.' .env` → 1 — OK |
| 8. Git repository | `.git` present on `main`; `.gitignore` created; user.name/user.email set — OK |
| 9. GitHub remote | none — committing locally only (B2) |
| 10. Tauri prerequisites | `pnpm tauri info` clean after raising `rust-version` to 1.90 (see below) |
| 11. Keep-awake | `caffeinate -dims` started in background |

## Phase 0 checklist

### 0. Environment
- [x] 0.1 §14 bootstrap (table above)

### 1. Scaffold
- [x] 1.1 create-tauri-app (React + TS, pnpm), converted to the §1.2 layout and a Cargo workspace (`src-tauri`, `crates/machi-core`, `crates/machi-platform`)
- [x] 1.2 Tailwind v4 + shadcn/ui foundations (Radix, cva, tailwind-merge), `src/styles/tokens.css` wired
- [x] 1.3 Window defaults (§15.2: 1280×820, min 960×620), bundle id `com.machi.app`
- [x] 1.4 tauri-specta binding generation into `src/lib/bindings.ts`
- [x] 1.5 Scripts: `pnpm lint` (ESLint + UI token check + dependency denylist), `pnpm typecheck`, `pnpm test` (Vitest + RTL)
- [x] 1.6 CI workflow `.github/workflows/ci.yml` (windows-latest + macos-latest)
- [x] 1.7 `pnpm tauri info` recorded below

### 2. Secrets
- [x] 2.1 `secrets`: keychain storage behind a trait + debug-only `.env` fallback, tests

### 3. Store
- [x] 3.1 `store`: SQLite schema + migrations (conversations, message tree, attachments, settings, model cache), tests

### 4. Providers
- [x] 4.1 `config/models.toml` seeded (prices checked against the Mixroute catalogue; unknown → null) + loader
- [x] 4.2 OpenAI-compatible adapter: model list fetch/cache with fallback, SSE streaming, cancellation, 429 backoff, capability flags, fixture tests
- [x] 4.3 `cargo run --example smoke` live smoke test; results recorded in DECISIONS.md
- [x] 4.4 Optional direct-provider adapters behind the same trait
- [x] 4.5 Chat service: context from the message tree, streaming persistence, stop, branching (edit/regenerate), compare, title generation, tests
- [x] 4.6 Tauri commands + events wired, bindings regenerated

### 5. UI (design system first, §15.12)
- [x] 5.1 Tokens (§15.10) + primitives: Button, IconButton+tooltip, Input, Textarea, Chip, Avatar, Badge, Card, Popover, Menu, Dialog, Toast, Skeleton, Tooltip, Tabs
- [x] 5.2 Dev-only `/gallery` route: every primitive × every state × both themes
- [x] 5.3 `machiClient` (Tauri backend + mock backend) and Zustand stores
- [x] 5.4 Shell: icon rail, chats flyout, hash router, keyboard shortcuts, toasts
- [x] 5.5 Composer (§15.7) incl. attachments, "@" mention, sliders popover
- [x] 5.6 Home screen (§15.5) incl. first-run key card
- [x] 5.7 Chat view (§15.6): header, messages, markdown/code/table/math, actions, streaming, scroll, errors, branches, edit
- [x] 5.8 Model picker (cmdk, §11.4) + Ctrl/Cmd+K
- [x] 5.9 Compare mode (§11.7)
- [x] 5.10 Models page (§15.8)
- [x] 5.11 Settings page (§15.11 two-column: Providers, Models, Appearance, Data, About + shortcuts)
- [x] 5.12 Global search palette (Ctrl/Cmd+Shift+F)

### 6. Hardening
- [x] 6.1 Error states (rate limit inline + switch model), export, delete-all data
- [x] 6.2 §11.12 checks: keyboard, contrast, no hard-coded colors/radii/font sizes, 200-message virtualized list, dependency denylist
- [x] 6.3 Playwright e2e + screenshots (§15.12) in both themes + visual review loop
- [x] 6.4 Repository grep for the reference app's name passes (§15.13) — only the spec matches, plus one coincidental substring inside a pnpm-lock integrity hash

### 7. Exit verification
- [x] 7.1 Live verification of core chat flows with a cheap and a premium model — `cargo run --example live_chat` (2026-10-18): live model list (15 IDs); with `gpt-4.1-nano` and `gpt-4.1` each: streaming, stop mid-stream, switching models mid-chat with context kept, regenerate branch, edit branch, generated title; compare mode with both models + "continue with column 2"; image on `gpt-4.1` read correctly (271 prompt tokens), image blocked on `gpt-4.1-nano`. All passed. Rate-limit handling is covered by the 429 fixture tests, the core inline-error test and the e2e error screenshot (a live 429 can't be triggered on demand).
- [x] 7.2 `pnpm tauri build` produces a working app on this machine — release compiled in 6 min; `Machi.app` (10.3 MiB, unsigned) via `pnpm tauri build --bundles app` (the DMG step needs Finder automation permission, D16/B5). Launched the packaged app: "machi core ready" (database created in `~/Library/Application Support/com.machi.app`), then "ui connected has_required_key=false" (webview loaded under the release CSP, IPC works, release ignores `.env` so it opens on the first-run card). Quit cleanly.
- [ ] 7.3 All exit criteria (§12 + §15.13) reviewed; summary written at the top of this file

## `pnpm tauri info`
- Environment: macOS 14.6.1 x86_64, Xcode 16.2 + CLT, rustc/cargo 1.99.1 (stable-x86_64-apple-darwin), node 24.14.0, pnpm 12.14.0.
- Packages: tauri 2.12.4, tauri-build 2.7.3, wry 0.57.0, tao 0.37.1, @tauri-apps/api 2.12.4, @tauri-apps/cli 2.12.3; tauri-plugin-opener 2.7.2 (Rust and JS).
- First run flagged a Rust/JS minor-version mismatch: the MSRV-aware resolver had picked tauri 2.11 because the workspace declared `rust-version = 1.85`. Raised to 1.90 (tauri 2.12's MSRV), `cargo update`, mismatch gone. Nothing needing sudo or a GUI was flagged.

## Visual review — deviation list (§15.12)
Round 1 (2026-10-18, all 20 screenshots reviewed against §15.1–§15.11 and the §15.0 rubric):
1. Home: no rail item is active, so "Where am I?" relies on the wordmark alone (§15.0 item 3). → Mark "New chat" active on the new-chat screen.
2. Accent overuse: primary buttons ("Test & save", "Save", "Save and send") use the accent fill; §15.0 item 5 limits the accent to selected states, links, Send and "See all". → Primary buttons become a strong neutral fill.
3. Error card (light): the pink fill reads as a colored section background; §15.6 asks for a red-tinted border. → Neutral surface, danger border and icon.
4. Settings: five visual levels (28 section title, 20 nav heading, 16 card titles, 14 labels, 13 helper), over the four in §15.0 item 7. → The nav heading becomes a small muted label.
5. 200 % text: the composer placeholder is clipped because the textarea height was measured at the old font size (§15.11). → One-line minimum in `lh` units and re-measure when the text size changes.
6. 200 % text: the rail's bottom items are cut off (§15.11). → The rail scrolls vertically when it can't fit.

Round 2 (after fixes, all screenshots regenerated by `pnpm e2e`): deviations 1–6 verified fixed in home-empty, home-first-run, chat-error, settings-providers and text-200-home. No new deviations. **List empty.**

Intentional (logged in DECISIONS.md D15): the selected model chip uses `--surface-active` as §15.5 specifies, not an accent tint (§15.0 item 9 wording); the Machi mark and the profile circle use the accent because §15.3 specifies it.
