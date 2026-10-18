# Machi — instructions for Claude Code

The full spec is docs/MASTER_PROMPT.md. Read all of it before doing any work. It is the source of truth; follow its §13 operating protocol at all times.

## Current phase
Phase 0 only. Do not start later phases.

## Project settings
- Bundle identifier: com.machi.app (change this line before the first build if you want your own)
- Development machine: macOS (Intel). No Homebrew; install tools per-user as described in §14 of the spec.
- OpenRouter key: provided via the OPENROUTER_API_KEY environment variable for development

## On start or resume
1. Read this file, docs/MASTER_PROMPT.md, PROGRESS.md, BLOCKERS.md and DECISIONS.md (create the last three if missing).
2. Run the §14 environment bootstrap (it only verifies if everything is already installed).
3. Continue from the first unticked task in PROGRESS.md.
4. Do not stop to ask questions: log blockers in BLOCKERS.md, log judgment calls in DECISIONS.md, and keep going.
5. When every Phase 0 exit criterion passes, summarize at the top of PROGRESS.md and stop.
