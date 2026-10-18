# PROGRESS — Phase 0 (desktop app shell + chat, no computer use)

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
- [ ] 4.2 OpenAI-compatible adapter: model list fetch/cache with fallback, SSE streaming, cancellation, 429 backoff, capability flags, fixture tests
- [ ] 4.3 `cargo run --example smoke` live smoke test; results recorded in DECISIONS.md
- [ ] 4.4 Optional direct-provider adapters behind the same trait
- [ ] 4.5 Chat service: context from the message tree, streaming persistence, stop, branching (edit/regenerate), compare, title generation, tests
- [ ] 4.6 Tauri commands + events wired, bindings regenerated

### 5. UI (design system first, §15.12)
- [ ] 5.1 Tokens (§15.10) + primitives: Button, IconButton+tooltip, Input, Textarea, Chip, Avatar, Badge, Card, Popover, Menu, Dialog, Toast, Skeleton, Tooltip, Tabs
- [ ] 5.2 Dev-only `/gallery` route: every primitive × every state × both themes
- [ ] 5.3 `machiClient` (Tauri backend + mock backend) and Zustand stores
- [ ] 5.4 Shell: icon rail, chats flyout, hash router, keyboard shortcuts, toasts
- [ ] 5.5 Composer (§15.7) incl. attachments, "@" mention, sliders popover
- [ ] 5.6 Home screen (§15.5) incl. first-run key card
- [ ] 5.7 Chat view (§15.6): header, messages, markdown/code/table/math, actions, streaming, scroll, errors, branches, edit
- [ ] 5.8 Model picker (cmdk, §11.4) + Ctrl/Cmd+K
- [ ] 5.9 Compare mode (§11.7)
- [ ] 5.10 Models page (§15.8)
- [ ] 5.11 Settings page (§15.11 two-column: Providers, Models, Appearance, Data, About + shortcuts)
- [ ] 5.12 Global search palette (Ctrl/Cmd+Shift+F)

### 6. Hardening
- [ ] 6.1 Error states (rate limit inline + switch model), export, delete-all data
- [ ] 6.2 §11.12 checks: keyboard, contrast, no hard-coded colors/radii/font sizes, 200-message virtualized list, dependency denylist
- [ ] 6.3 Playwright e2e + screenshots (§15.12) in both themes + visual review loop
- [ ] 6.4 Repository grep for "Poe" passes (§15.13)

### 7. Exit verification
- [ ] 7.1 Live verification of core chat flows with a cheap and a premium model
- [ ] 7.2 `pnpm tauri build` produces a working app on this machine
- [ ] 7.3 All exit criteria (§12 + §15.13) reviewed; summary written at the top of this file

## `pnpm tauri info`
- Environment: macOS 14.6.1 x86_64, Xcode 16.2 + CLT, rustc/cargo 1.99.1 (stable-x86_64-apple-darwin), node 24.14.0, pnpm 12.14.0.
- Packages: tauri 2.12.4, tauri-build 2.7.3, wry 0.57.0, tao 0.37.1, @tauri-apps/api 2.12.4, @tauri-apps/cli 2.12.3; tauri-plugin-opener 2.7.2 (Rust and JS).
- First run flagged a Rust/JS minor-version mismatch: the MSRV-aware resolver had picked tauri 2.11 because the workspace declared `rust-version = 1.85`. Raised to 1.90 (tauri 2.12's MSRV), `cargo update`, mismatch gone. Nothing needing sudo or a GUI was flagged.

## Visual review — deviation list (§15.12)
(pending)
