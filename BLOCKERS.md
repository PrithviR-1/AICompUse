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
