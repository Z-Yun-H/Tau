# Changelog

All notable changes to Tau are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## Unreleased

### Fixed

- **Fresh-clone gate repairs** — the pre-PR gate (`pnpm lint && pnpm typecheck
  && pnpm test`) failed on a fresh clone under pnpm's isolated `node_modules`
  layout, even though it passed on the maintainer's machine:
  - `pnpm build` could not resolve `tsdown` from the root script (it was
    declared only in each sub-package); `tsdown` now sits in the root
    `devDependencies` so the unified workspace build works everywhere.
  - `pnpm typecheck` failed on `@tau/webui`'s type-only `import type { Command }
    from "commander"` — a phantom dependency satisfied only through sibling
    hoisting. `commander` is now declared (as a devDependency — it is erased at
    runtime) in `@tau/webui`.
  - The MCP stdio E2E test created its scratch dir at the vitest cwd, so the
    spawned `.mjs` server could not resolve `@modelcontextprotocol/sdk` when
    the suite ran from the repo root. The scratch dir is now derived from the
    test file location (inside `packages/plugins/`), independent of cwd.

### Added

- **Per-package READMEs.** Every workspace package (`@tau/core`, `@tau/tools`,
  `@tau/engine`, `@tau/ai`, `@tau/skills`, `@tau/plugins`, `@tau/agent`,
  `@tau/ui`) and every app (`@tau/cli`, `@tau/tui`, `@tau/webui`) now ships
  its own README: public API surface, dependencies, asset notes (where
  relevant), dev commands and links to the matching AGENTS rulebooks. Root
  READMEs point to them from the project-layout section.

- **AI commit declaration.** Commits authored by AI agents must never be
  silent: the agent presents the declaration before committing and the commit
  message ends with a grep-able `AI-declaration:` trailer block (agent, scope,
  real gate status). Convention codified in AGENTS/release.md and
  CONTRIBUTING.md, with a commit template in `.gitmessage` (wired via
  `git config commit.template`) and a checklist item in the PR template.

### Changed

- **Unified tsdown workspace build.** `pnpm build` now runs a single tsdown
  process in workspace mode (root `tsdown.config.ts`,
  `workspace: ["packages/*", "app/*"]`) instead of a `pnpm -r build` fan-out.
  Per-feature-area `tsdown.config.ts` files are untouched and still merge on
  top of the shared base (`@tau/ai` / `@tau/plugins` neverBundle their
  optional SDKs, `@tau/webui` keeps its second `server.ts` entry), and
  `pnpm --filter <pkg> build` still builds a single package. All 24 build
  outputs are byte-identical to the per-package build; bin shebangs and
  execute bits preserved.

- **Flattened the workspace file structure.** The monorepo migration had left
  every package with a redundant folder duplicating its own name
  (`packages/ai/src/ai/...`, `packages/tools/src/tools/...`,
  `packages/engine/src/core/...`, `app/cli/src/cli/...`, and so on). All
  sources now sit directly in `<pkg>/src/` — e.g. `packages/ai/src/providers/
deepseek.ts`, `packages/engine/src/safety.ts`, `app/cli/src/ask.ts`. The
  tools bootstrap barrel became `packages/tools/src/bootstrap.ts`; bundled
  skills moved from `packages/skills/skills/` to `packages/skills/bundled/`;
  the dead root-level `tsdown.config.ts` (single-package leftover) was
  removed. No public API changes — all 233 tests pass untouched, and the PR
  workflow (branch + pull request, never direct pushes to `main`) is now
  codified in CONTRIBUTING.md / AGENTS/release.md with a PR template in
  `.github/`.

- **pnpm monorepo restructure.** The single `src/` tree is now a pnpm
  workspace: UI apps in `app/` and the reusable engine in `packages/`, each
  an independent `@tau/*` package with its own package.json, tsdown build,
  and colocated tests (root vitest aliases `@tau/*` to TypeScript sources):
  - `app/cli` (`@tau/cli`, bin `tau`) — the commander terminal app; new
    `tau tui` / `tau web` bridges hand off to the two new UI apps
  - `app/tui` (`@tau/tui`, bin `tau-tui`) — NEW interactive terminal session
    (REPL): intents go through the same plan → review → confirm → runPlan
    pipeline as `tau ask`; `/help /provider /skills /history /status /clear`
    manage the session
  - `app/webui` (`@tau/webui`, bin `tau-web`) — NEW zero-dependency localhost
    web interface (node:http + vanilla JS): status/skills/history views and a
    plan → review → execute chat flow; deny verdicts are refused server-side
    and high-risk plans demand explicit confirmation
  - `packages/core|tools|engine|ai|skills|plugins|agent|ui` — engine layer;
    NEW `@tau/agent` extracts the intent→plan orchestration (catalog prep,
    plugin warnings, provider resolution) previously inlined in the CLI
  - Cross-package imports now go through declared `@tau/*` `workspace:*`
    dependencies and package barrels; relative escapes are gone. Bundled
    skills/templates moved with `@tau/skills`; `packageRoot()` asset
    resolution moved from `@tau/core` to `@tau/skills`
  - Tooling: `pnpm build` is a unified tsdown workspace build (one process,
    per-package configs still merged); `packageManager`
    pins pnpm; devcontainer post-create uses corepack + pnpm; gates are
    `pnpm lint && pnpm typecheck && pnpm test:cov` (216 → 233 tests)
  - Author attribution cleaned up: remaining `ZHYun` strings in READMEs and
    bundled SKILL.md frontmatter are now `Z-Yun-H`

### Added

- **Provider model-selection mode** (`tau provider list/set-key/models/use`):
  providers now expose live model discovery (`GET /models` for
  openai/deepseek, `/api/tags` for ollama, a demo catalog for mock). As soon
  as an API key is configured, the model catalog is fetched automatically
  and cached (`providers.<name>.availableModels` + `modelsRefreshedAt`,
  24 h TTL), so model choices are always real and current:
  `tau provider set-key deepseek <key>` stores the key (config file chmod 0600) **and auto-refreshes the catalog in the same command**;
  `tau provider models [--refresh|--offline]` browses it;
  `tau provider use <provider> [model]` selects provider + model with an
  interactive arrow-key picker on a TTY (numbered fallback otherwise; CI
  sessions never hang on stdin). API keys resolve config-first with env vars
  as fallback, every CLI surface masks them, and a failed refresh degrades
  to the cached list instead of failing. New `packages/ai/src/models.ts` catalog
  service, `packages/ui/src/picker.ts` zero-dependency selector, `app/cli/src/provider.ts`
  command family.
- Dotted config keys: `tau config get/set providers.<name>.<field>`
  (`apiKey`, `baseUrl`, `host`, `model`, `timeoutMs`) with per-provider
  deep-merge of bundled defaults, `chmod 0600` on the config file, and
  `maskSecret`/`redactConfig` so `tau config get/list` never prints a raw
  API key.
- **DeepSeek provider** (`deepseek`): official DeepSeek chat-completions
  streaming wire format, enabled by `DEEPSEEK_API_KEY`; model/baseUrl/timeout
  via `providers.deepseek`. The provider is now a genuine DeepSeek Harness
  adapter: it subclasses the official abstract `LlmAdapter` from
  `@deepseek-ai/dsh-llm` (provider-neutral LLM seam) and speaks the
  canonical `StreamChunk` protocol (`block-start`/`text-delta`/
  `reasoning-delta`/`tool-call-delta`/`block-end`/`usage`/`finish`) with the
  official adapter's exact mappings — disjoint token usage (cache reads
  subtracted from input), finish-reason vocabulary, and the stable
  `LlmError` code taxonomy (`AUTH`, `RATE_LIMIT`, `SERVER`, `QUOTA_EXCEEDED`,
  `CONTEXT_WINDOW_EXCEEDED`, `EMPTY_RESPONSE`, `STREAM_CLOSED`,
  `MALFORMED_RESPONSE`, `TRANSPORT`). Plans assemble through the official
  `BlockAssembler`; credentials are judged by the official
  `assertUsableApiKey`; requests carry the official `attributionHeaders()`
  identity (`tau/<version> (+url)`). The transport itself is Tau's
  (global fetch + SSE) because the only official HTTP adapter
  (`@deepseek-ai/dsh-llm-deepseek`) remains uninstallable standalone — its rc peer
  `dsh-environment` is not published. When the optional package is absent
  (`--omit=optional`), the provider falls back to a zero-dependency
  implementation of the identical wire contract; behavior and diagnostics
  stay the same.
- **MCP plugin system** (`tau plugin list/add/remove/enable/disable/tools`):
  connect external tool servers — dsh (DeepSeek Harness), VS Code bridges,
  filesystem/GitHub servers — via `stdio` or Streamable `http` transports.
  Discovered tools join the AI planner catalog as
  `plugin.<name>.<tool>` and execute through the same plan → review →
  confirm pipeline. Plugin tools are always **medium risk**; connect
  handshake 10 s, tool call cap 120 s, 64 KB argument budget; env extras
  layered over the SDK's safe default allowlist. New `packages/plugins/src/` module,
  `docs/plugins.md` guide, AGENTS/plugins.md rulebook.
- `@modelcontextprotocol/sdk` joins as an `optionalDependency` (dynamically
  imported, never bundled; Tau degrades gracefully without it).
- `@deepseek-ai/dsh-llm` joins as an `optionalDependency` under the same
  doctrine: dynamically imported through `loadDshLlm()`, excluded from the
  bundle (`deps.neverBundle`), and the deepseek provider degrades to its
  built-in wire client when it is absent.

### Changed

- **No bundled default models**: providers used to fall back to hardcoded
  models (`gpt-4o-mini`, `deepseek-chat`, `llama3.1`, `glm-4-flash`); those
  are gone. Request-time resolution goes explicit config → single-model
  catalog (auto-selected and persisted) → an actionable error
  (`tau provider use <provider>` / `tau config set providers.<name>.model
<id>`) via the new `resolveModel()` in `packages/ai/src/models.ts`; `provider list`
  shows `(auto)` for unset models.
- Repository housekeeping: the `AGENTS.d/` rulebook directory renamed to
  `AGENTS/` (all references updated); every source file under `src/` now
  carries a file-level documentation header; project identity corrected to
  `Z-Yun-H` in `package.json` author and the LICENSE copyright line.
- Dependency refresh to current latest: zod 4, commander 15, chalk 6,
  vitest 4 (+ @vitest/coverage-v8 4), TypeScript 7, @types/node 26,
  tsx 4.23, yaml 2.9; oxlint/oxfmt/tsdown stay on their latest
  (1.80.0 / 0.65.0 / 0.22.14). Full gate suite re-run green.
- Tests grew from 172 to 211 (model-catalog service: live/cache/unsupported
  paths, TTL staleness and cache degradation; provider `listModels` request
  shaping and parsing; dotted config keys and secret masking; the
  `tau provider` CLI flow; the TTY arrow-key picker and hidden key prompt
  driven through injectable streams).
- Tests grew further from 211 to 216 (resolveModel precedence, auto-select
  and guidance paths; deepseek plan tests now isolate `TAU_HOME` with
  explicit models instead of relying on bundled defaults).
- `tau ask` unavailable-provider tips now point at
  `tau provider set-key <provider> <key>`.
- Config file permissions tighten to 0600 on every write (it may hold API
  keys now).

### Changed (prior work, same release)

- **Dev toolchain migrated to the oxc ecosystem** (zero runtime impact on the
  published CLI): bundler `tsup` → `tsdown` (rolldown/oxc; shebang and exec
  bit preserved automatically), linter ESLint 9 flat config → `oxlint`
  (`.oxlintrc.json`, ~15 ms over 45 files), formatter Prettier → `oxfmt`
  (`.oxfmtrc.json`, prettier-compatible — byte-stable on the existing tree;
  `templates/` kept in `ignorePatterns` so `{{placeholders}}` survive).
- Contributor Node requirement raised to **>= 22.18** (declared via
  `devEngines.runtime`); the published CLI still targets and runs on
  Node >= 20.19.
- VS Code / Dev Container switched to the official `oxc.oxc-vscode`
  extension (lint + format on save); Dev Container image bumped to
  Node 24.

## 0.1.0 - 2026-08-30

Initial public build of Tau — AI-powered unified terminal assistant.

### Added

- **`tau ask`** — natural language (English/Chinese) → provider plan →
  deterministic safety review → interactive confirmation → execution → history.
- **Built-in tool families**: `file` (find/tree/stat/rename with dry-run
  default), `sys` (info/disk/proc), `net` (port/ping/fetch with SSRF
  guard/ip), `text` (search/replace with dry-run default/count).
- **Safety model**: deny list (sudo, rm -rf /, curl|sh, dd of=/dev, force
  push, ...), caution list escalation, structural caps (≤10 steps, output and
  length limits), risk levels low/medium/high/blocked, honest `--yes`.
- **AI provider layer**: pluggable `AIProvider` interface with `mock`
  (offline default), `ollama`, `openai` (any compatible endpoint), `zai`
  (optional SDK, graceful degradation).
- **Skills system**: SKILL.md frontmatter contract, three scopes
  (bundled/user/workspace) with precedence, `tau skill
list/show/new/validate`, bundled `git-helper` and `docker-helper` skills,
  scaffold template via `tau skill new`.
- **Session memory**: `tau history` (list/show/replay/clear) on an
  append-only JSONL store; `tau alias` persistent aliases; `tau config`
  get/set/list/path/reset under `$TAU_HOME`.
- **AI-friendly repo**: `AGENTS.md` + `AGENTS/` rulebook system
  (architecture/conventions/testing/skills/ai-integration/release),
  `.claude/skills/` dev-workflow skills, `CLAUDE.md` pointer.
- **Engineering**: strict TypeScript (ESM), vitest suite (108 tests, 82%
  coverage), ESLint flat config + Prettier, Dev Container, bilingual
  README (English / 中文).
