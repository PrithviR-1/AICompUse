# DECISIONS

Judgment calls made while building, each with context, decision and consequence (§13.2 item 4).

## D1 — Mixroute stays the primary provider; OpenRouter becomes an optional direct provider
- **Context:** `CLAUDE.md` says "OpenRouter key: provided via the OPENROUTER_API_KEY environment variable". The spec (§0.3, §1.3, §11.9, §14.2 step 7) says Mixroute is the primary and only required provider, with `MIXROUTE_API_KEY` in `.env`. The `.env` file contains `MIXROUTE_API_KEY` and no `OPENROUTER_API_KEY`, and the shell environment also has `MIXROUTE_API_KEY` set.
- **Decision:** follow the spec. Mixroute is primary. Because every provider goes through one OpenAI-compatible adapter, OpenRouter (`https://openrouter.ai/api/v1`) is added as one of the optional direct providers. In debug builds only, a missing keychain key falls back to the `.env` file and then to the process environment (`MIXROUTE_API_KEY`, `OPENROUTER_API_KEY`, …).
- **Consequence:** the app works with only the Mixroute key, as the exit criteria require, and an OpenRouter key also works if supplied.

## D2 — Section 15 appended to the spec
- **Context:** the user supplied §15 (the professional UI addendum modeled on a reference aggregator) in the session prompt. It overrides §11's layout and style rules and adds exit criteria.
- **Decision:** append it verbatim to `docs/MASTER_PROMPT.md` so that it survives context resets and is part of the source of truth.
- **Consequence:** where §11 and §15 conflict, §15 wins (window 1280×820 / min 960×620, icon rail instead of the 260 px sidebar, §15.10 tokens instead of the §11.2 blue accent, settings as a full-page route instead of a modal, no model pill in the composer, no suggestion chips).

## D3 — The reference screenshot is not stored in the repository
- **Context:** §15.1 mentions a reference screenshot under `docs/reference/`, but §15.13 forbids the reference app's logo or artwork anywhere in the repository, and the screenshot contains its logo, wordmark and bot icons.
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
- **Decision:** Phase 0 creates only the Phase 0 modules (`providers`, `store`, `secrets`, `telemetry`, `chat`, `models`). The `machi-platform` crate exists as a workspace member that compiles on both OSes and holds only `PlatformInfo` (OS and shortcut-modifier label for the shortcuts list), with `mac`, `win` and `mock` adapters; its accessibility/capture/input adapters arrive in Phase A.
- **Consequence:** no placeholder logic ships; the workspace layout is already in place for Phase A.

## D7 — TypeScript pinned to 6.0.x
- **Context:** `pnpm add typescript` resolved to 7.0 (the native port), but `typescript-eslint` 8.x supports `>=4.8.4 <6.1.0` only.
- **Decision:** pin `typescript@~6.0.3`, the same version `create-tauri-app` generated.
- **Consequence:** linting with type-aware rules works; revisit when typescript-eslint supports TS 7.

## D8 — Two token values changed for WCAG AA contrast
- **Context:** §11.12 requires WCAG AA text contrast. The §15.10 `--text-faint` values measure about 4.0:1 (dark, #71717a on #0e0e10) and 3.3:1 (light, #8e8e98 on white), below the 4.5:1 AA minimum. White text on the dark accent `#7c7cf2` is about 3.6:1.
- **Decision:** `--text-faint` becomes `#8a8a94` (dark) and `#6f6f78` (light). Filled accent controls (Send, primary buttons) use a new `--accent-fill` token (`#5e5ff0`, a slightly deeper periwinkle between the spec's `--accent` and `--accent-strong`) in dark and the light accent in light, so white text and icons pass AA. Danger-filled buttons use `--danger-strong`. `--accent` is unchanged and is still used for links, "See all", focus rings and selected states. A unit test checks every text/background token pair.
- **Consequence:** faint labels are slightly brighter than the reference. The palette still has exactly one accent hue.

## D9 — reqwest uses the OS TLS stack
- **Context:** reqwest 0.13's default TLS is rustls with aws-lc, which needs a C/assembler toolchain on Windows CI runners.
- **Decision:** `default-features = false` with `native-tls` (Security.framework on macOS, SChannel on Windows).
- **Consequence:** no extra native build tools are needed on either OS.

## D10 — Token variable names
- **Context:** Tailwind v4's `@theme` namespaces (`--radius-*`, `--shadow-*`, `--ease-*`) would emit self-referencing variables if tokens.css used the same names.
- **Decision:** tokens.css uses `--shape-*` for radii, `--elevation-popover` for the shadow and `--motion-ease` for easing, and `index.css` maps them to Tailwind's `rounded-*`, `shadow-*` and `ease-*` utilities. Default Tailwind colors, radii, font sizes and shadows are removed so only token-backed utilities exist.
- **Consequence:** a component cannot use a non-token color, radius or font size without failing the build or the UI check.

## D11 — Model catalog seeding (2026-10-18)
- **Context:** Mixroute's `GET /models` returned 23 IDs (with `owned_by` and `supported_endpoint_types` only). The public catalogue at mixroute.ai/models lists prices using slug IDs (dots become dashes). `mixroute.ai/pricing` has no per-model table. The docs page lists context windows for a few models.
- **Decision:**
  - Prices confirmed in the catalogue are seeded: gpt-5 (1.25/10.00), gpt-5-mini (0.25/2.00), gpt-5-nano (0.05/0.40), deepseek-v4-flash (0.14/0.28), gemini-2.5-flash (0.30/2.50), gemini-3.5-flash-lite (0.30/1.20), kimi-k2.5 (0.60/3.00), qwen3.6-flash (0.25/1.50), MiniMax-M2.5 (0.30/1.20).
  - The gpt-4.1 and gpt-4o families are live but not in the catalogue, so their prices are omitted and shown as "Price unknown".
  - `glm-4-flash` is listed as free on the website but is **not** in `GET /models`, so it is seeded without `free = true` and stays hidden until Mixroute serves it.
  - Dated snapshot IDs (`gpt-4.1-2025-04-14`, …) are hidden when the undated ID is live, to avoid duplicate rows.
  - `gemini-2.5-flash-image` is seeded with `hidden = true` because it is an image-generation model whose output the chat view doesn't render.
  - Context windows come from the Mixroute docs where listed (deepseek-v4-flash, gemini-3.5-flash-lite, kimi-k2.5), otherwise from vendor documentation; unknown ones are omitted.
  - The seed file is embedded with `include_str!` so the app needs no resource lookup.
  - Cheap test model: `gpt-4.1-nano` (spec default). Premium test model: `gpt-5`, the most capable model Mixroute serves (no Claude/Opus model is live).
- **Consequence:** the Models page shows real prices where confirmed and "Price unknown" elsewhere. Adding a model is a `config/models.toml` edit.

## D12 — Live smoke test results (`cargo run --example smoke`, 2026-10-18)
- **`/models`:** works (≈ 0.2–0.3 s, 23 IDs). A missing or bad key returns 401, so "Test & save" validates keys with `GET /models` at no cost.
- **Streaming:** works on `gpt-4.1-nano` (cheap) and `gpt-4.1` (premium) with `stream_options.include_usage` (usage arrives in the final chunk). Chunks arrive progressively, but OpenAI models have ≈ 8–10 s time-to-first-token through the gateway (Gemini 2.5 Flash ≈ 1.3 s). The UI shows a skeleton shimmer while waiting.
- **Premium model:** `gpt-5` and `gpt-5-mini` are listed by `/models` but refused upstream ("Your organization must be verified…", code `model_not_found`). **Decision:** the premium test model is `gpt-4.1`; gpt-5/gpt-5-mini stay visible (the inline error explains the refusal) but are demoted from the home Models row. `gpt-5-nano` works.
- **Image input:** only consumed by `gpt-4.1`, `gpt-4o-mini`, `gemini-2.5-flash`, `gemini-3.5-flash-lite` and `qwen3.6-flash` (prompt tokens jump by ≈ 250+). The gateway silently drops image parts for `gpt-4.1-nano`, `gpt-4.1-mini` and `gpt-5-nano` (the model replies that it can't see an image). **Decision:** `vision = false` for those in `config/models.toml`, so the UI blocks images on them with an inline hint instead of sending them silently.
- **Structured output:** `response_format: json_schema` with `strict: true` fails with HTTP 400 for every OpenAI model through Mixroute ("'additionalProperties' is required to be supplied and to be false" even when supplied, so the gateway strips it). It works on `gemini-2.5-flash`. `json_object` mode and non-strict `json_schema` work on all tested models. **Decision:** `structured_output = false` for the OpenAI models, so the Phase A agent uses JSON mode plus the validator for them (§5.3). Agent eligibility is unaffected because they support tools.
- **Request quirks:** OpenAI reasoning models (gpt-5*, o*) get `max_completion_tokens` instead of `max_tokens` and no custom temperature.

## D13 — Direct providers use their OpenAI-compatible endpoints
- **Context:** §1.3 asks for optional direct adapters (Anthropic, OpenAI, Gemini, DeepSeek, any OpenAI-compatible endpoint) behind the same trait. All of them offer an OpenAI-compatible `/chat/completions`.
- **Decision:** one `OpenAiCompatible` adapter serves every provider, configured by `ProviderId` (base URL, env var, key-check path, extra headers): OpenAI `api.openai.com/v1`, Anthropic `api.anthropic.com/v1` (OpenAI SDK compatibility layer, plus `x-api-key`/`anthropic-version` headers for `/models`), Gemini `generativelanguage.googleapis.com/v1beta/openai`, DeepSeek `api.deepseek.com/v1`, OpenRouter `openrouter.ai/api/v1` (key verified with `GET /key`, because its `/models` is public). Direct-provider models are listed from their live `/models` with unknown metadata unless seeded.
- **Consequence:** no provider-specific protocol code. Features only available in native APIs (e.g. Anthropic prompt caching) wait for a native adapter behind the same trait. Direct providers were not tested live (no keys supplied); fixtures cover the request shape.

## D14 — Smaller debug builds (disk space)
- **Context:** with 12 GiB free at the start (B1), the debug `target/` reached 6.6 GB and the disk fell to 1.3 GiB free.
- **Decision:** `[profile.dev] debug = "line-tables-only"` with `debug = false` for all dependencies, and the Tauri lib crate builds only `rlib` (the `staticlib`/`cdylib` crate types from the template exist for iOS/Android, which Machi doesn't target).
- **Consequence:** `target/` is ≈ 1.4 GB; backtraces in dependencies lose line info in debug builds. Mobile targets would need the crate types back.

## D15 — Accent and selection rules from the visual review
- **Context:** §15.0 item 5 limits the accent to selected states, links, the Send button and "See all"; item 9 says the selected item gets an "accent-tinted" treatment, while §15.5 specifies `--surface-active` for the selected chip; §15.3 specifies the accent for the Machi mark and the profile circle.
- **Decision:** primary buttons use a strong neutral fill (`--text` on `--bg`) instead of the accent. Send, links, "See all", focus rings (required by §15.11), switches and sliders in their on state, the Machi mark and the profile circle keep the accent. Selected chips, tabs and rail items use `--surface-active` as §15.5 and §15.3 specify.
- **Consequence:** the accent marks only the primary send action, links and selection, so it stays meaningful; primary buttons are still the highest-contrast control in their card.
