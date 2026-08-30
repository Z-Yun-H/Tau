# Changelog

All notable changes to Tau are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## Unreleased

### Changed

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
