# Changelog

All notable changes to Tau are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## Unreleased

### Added

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
  layered over the SDK's safe default allowlist. New `src/plugins/` module,
  `docs/plugins.md` guide, AGENTS.d/plugins.md rulebook.
- `@modelcontextprotocol/sdk` joins as an `optionalDependency` (dynamically
  imported, never bundled; Tau degrades gracefully without it).
- `@deepseek-ai/dsh-llm` joins as an `optionalDependency` under the same
  doctrine: dynamically imported through `loadDshLlm()`, excluded from the
  bundle (`deps.neverBundle`), and the deepseek provider degrades to its
  built-in wire client when it is absent.

### Changed

- Tests grew from 108 to 172 (SSE wire parsing, provider request shaping,
  plugin config CRUD, MCP tool mapping, real InMemory + spawned-stdio MCP
  integration, plugin CLI flows).

### Changed (toolchain, previously unreleased note)

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
- **AI-friendly repo**: `AGENTS.md` + `AGENTS.d/` rulebook system
  (architecture/conventions/testing/skills/ai-integration/release),
  `.claude/skills/` dev-workflow skills, `CLAUDE.md` pointer.
- **Engineering**: strict TypeScript (ESM), vitest suite (108 tests, 82%
  coverage), ESLint flat config + Prettier, Dev Container, bilingual
  README (English / 中文).
