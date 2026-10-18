# DECISIONS

Judgment calls made while building, each with context, decision and consequence (§13.2 item 4).

## D1 — Mixroute stays the primary provider; OpenRouter becomes an optional direct provider
- **Context:** `CLAUDE.md` says "OpenRouter key: provided via the OPENROUTER_API_KEY environment variable". The spec (§0.3, §1.3, §11.9, §14.2 step 7) says Mixroute is the primary and only required provider, with `MIXROUTE_API_KEY` in `.env`. The `.env` file contains `MIXROUTE_API_KEY` and no `OPENROUTER_API_KEY`, and the shell environment also has `MIXROUTE_API_KEY` set.
- **Decision:** follow the spec. Mixroute is primary. Because every provider goes through one OpenAI-compatible adapter, OpenRouter (`https://openrouter.ai/api/v1`) is added as one of the optional direct providers. In debug builds only, a missing keychain key falls back to the `.env` file and then to the process environment (`MIXROUTE_API_KEY`, `OPENROUTER_API_KEY`, …).
- **Consequence:** the app works with only the Mixroute key, as the exit criteria require, and an OpenRouter key also works if supplied.

## D2 — Section 15 appended to the spec
- **Context:** the user supplied §15 (Poe-style professional UI addendum) in the session prompt. It overrides §11's layout and style rules and adds exit criteria.
- **Decision:** append it verbatim to `docs/MASTER_PROMPT.md` so that it survives context resets and is part of the source of truth.
- **Consequence:** where §11 and §15 conflict, §15 wins (window 1280×820 / min 960×620, icon rail instead of the 260 px sidebar, §15.10 tokens instead of the §11.2 blue accent, settings as a full-page route instead of a modal, no model pill in the composer, no suggestion chips).

## D3 — The reference screenshot is not stored in the repository
- **Context:** §15.1 mentions `docs/reference/poe-home.png`, but §15.13 forbids any Poe logo or artwork anywhere in the repository, and the screenshot contains Poe's logo, wordmark and bot icons.
- **Decision:** do not commit it. Compare against the screenshot from the session and the measurements in §15.1.
- **Consequence:** the repository stays free of third-party brand assets.

## D4 — Repository root
- **Context:** §1.2 shows the layout under a `machi/` folder, but the repository already exists at `aggregator-desktop/` with `CLAUDE.md` and `docs/` at its root.
- **Decision:** apply the §1.2 layout at the existing repository root.
- **Consequence:** none functionally; paths in the spec map one-to-one.

## D5 — pnpm installed under ~/.local
- **Context:** Node 24 is installed system-wide in `/usr/local`, so `corepack enable` fails with a permissions error.
- **Decision:** use the §14.2 step 6 fallback: `npm install -g pnpm --prefix "$HOME/.local"`, and add `$HOME/.local/bin` to PATH in the shell prefix.
- **Consequence:** `pnpm` is only on PATH when the prefix in PROGRESS.md is used.

## D6 — Computer-use modules are not created in Phase 0
- **Context:** §1.2/§1.3 list `observe`, `vision`, `context`, `router`, `act`, `workflows`, `integrations`, `schema/action.v1.json`, `config/vision_costs.toml` and `config/apps/`, but they belong to Phases A–C, and §0.4 forbids silent stubs.
- **Decision:** Phase 0 creates only the Phase 0 modules (`providers`, `store`, `secrets`, `telemetry`, `chat`, `models`). The `machi-platform` crate exists as a workspace member that compiles on both OSes and holds only the app-data path helper used by Phase 0; its accessibility/capture/input adapters arrive in Phase A.
- **Consequence:** no placeholder logic ships; the workspace layout is already in place for Phase A.

## D7 — TypeScript pinned to 6.0.x
- **Context:** `pnpm add typescript` resolved to 7.0 (the native port), but `typescript-eslint` 8.x supports `>=4.8.4 <6.1.0` only.
- **Decision:** pin `typescript@~6.0.3`, the same version `create-tauri-app` generated.
- **Consequence:** linting with type-aware rules works; revisit when typescript-eslint supports TS 7.

## D8 — Two token values changed for WCAG AA contrast
- **Context:** §11.12 requires WCAG AA text contrast. The §15.10 `--text-faint` values measure about 4.0:1 (dark, #71717a on #0e0e10) and 3.3:1 (light, #8e8e98 on white), below the 4.5:1 AA minimum. White text on the dark accent `#7c7cf2` is about 3.6:1.
- **Decision:** `--text-faint` becomes `#8a8a94` (dark) and `#6f6f78` (light). Filled accent controls (Send, primary buttons) use a new `--accent-fill` token, `#6366f1` (the spec's `--accent-strong`) in dark and the light accent in light, so white text and icons pass AA. Danger-filled buttons use `--danger-strong`. `--accent` is unchanged and is still used for links, "See all", focus rings and selected states. A unit test checks every text/background token pair.
- **Consequence:** faint labels are slightly brighter than the reference. The palette still has exactly one accent hue.

## D9 — reqwest uses the OS TLS stack
- **Context:** reqwest 0.13's default TLS is rustls with aws-lc, which needs a C/assembler toolchain on Windows CI runners.
- **Decision:** `default-features = false` with `native-tls` (Security.framework on macOS, SChannel on Windows).
- **Consequence:** no extra native build tools are needed on either OS.

## D10 — Token variable names
- **Context:** Tailwind v4's `@theme` namespaces (`--radius-*`, `--shadow-*`, `--ease-*`) would emit self-referencing variables if tokens.css used the same names.
- **Decision:** tokens.css uses `--shape-*` for radii, `--elevation-popover` for the shadow and `--motion-ease` for easing, and `index.css` maps them to Tailwind's `rounded-*`, `shadow-*` and `ease-*` utilities. Default Tailwind colors, radii, font sizes and shadows are removed so only token-backed utilities exist.
- **Consequence:** a component cannot use a non-token color, radius or font size without failing the build or the UI check.
