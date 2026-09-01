# Changelog

All notable changes to Tau are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## Unreleased

### Added

- **Compound-request decomposition codified in the AI collaboration norms.**
  A maintainer request spanning multiple change types or subsystems must be
  auto-decomposed into independently reviewable one-Issue-one-PR units
  BEFORE implementation, with the decomposition plan published first (the
  Issues are the publication); ordering follows norms/docs → refactor →
  feature, and stacked units must declare their merge order.
  `AGENTS/collaboration.md` §3 gains the normative subsection (+ English
  TL;DR and pre-task self-check entries); `AGENTS.md` gains golden rule 9
  plus a change-checklist item. (#35)
- **WebUI agent mode — conversations, threads, keyboard, markdown preview.**
  The chat stream becomes a real conversation: user bubbles + assistant
  turns with the plan card and result card in the same turn; multiple
  conversations persist locally (`localStorage` threads — server history
  stays the durable record) with a new/switch/delete sidebar (two-step
  inline delete) that becomes an overlay drawer on narrow screens. Full
  keyboard contract: Enter send, Shift+Enter newline, Ctrl/⌘+K focus,
  `?` shortcuts panel, Alt+N new thread, Alt+S reference-rail toggle, Esc
  close — documented in-app via ShortcutsModal and the composer hint row.
  Results and plan explanations preview as markdown via a dependency-free,
  escape-first renderer (`client/lib/markdown.ts`) with rendered/raw
  toggle, one-click copy and expand; the composer is an auto-growing
  textarea. Server: `GET /api/history` accepts `?limit=` (default 20,
  cap 500). No new runtime dependencies; the safety pipeline is untouched —
  the WebUI remains a front door over the same `runPlan()` channel. (#37)

- **AI collaboration norms v2 (updated 2026-09) + daily changelog folder.**
  `AGENTS/collaboration.md` now transcribes the maintainer's updated
  collaboration directive: daily `changelog/YYYY-MM-DD.md` files (summary /
  type / Issue-PR refs / impact) feeding the release-level `CHANGELOG.md`,
  change-type flow split (Issue+PR for features/refactors/architecture,
  direct commits on a branch only for simple unambiguous fixes — `main`
  stays protected so everything lands via PR), a tech-selection freeze
  (new framework/lib/tool requires an approved Issue first), dead-code &
  hardcoded-logic cleanup duties, a dedicated testing & quality gate
  (results reported in every PR body; CI failures root-caused, never
  bypassed), doc root-vs-subpackage responsibilities, and a pre-task
  self-check list. `AGENTS.md` (golden rules 7–8, change checklist, commit
  style) and the dev-workflow skills (`.claude/skills/tau-release`,
  `.claude/skills/tau-test`) were synced accordingly. (#31)

### Fixed

- **`file.find --type file` no longer lists directories.** The type filter
  in `findTool` carried an unreachable branch (`type === "dir"` was checked
  inside the isFile-only path) and matching directories were pushed
  unconditionally, so `tau file find --type file` still returned
  directories. The filter now applies to files and directories
  independently; the dead branch is gone and `type=file` / `type=dir` have
  regression tests. Also deduplicated the prune-set: the text family now
  reuses `file.ts`'s exported `PRUNE_DIRS` instead of a drifted-in-waiting
  duplicate `SKIP_DIRS` (same set, behavior unchanged). (#36)

- **`pnpm build` now also builds `@tau/tui` and `@tau/webui`.** After the
  unified tsdown workspace build landed, the root build script was just
  `tsdown` with `workspace: ["packages/*", "app/cli"]` — the two vite-based
  apps were intentionally outside the glob, but nothing else ever triggered
  their `vite build` either. `pnpm build` therefore left `app/tui/dist/`
  and `app/webui/dist/` missing on a fresh clone, and the built CLI (which
  imports `@tau/tui/dist/index.js`) crashed with `ERR_MODULE_NOT_FOUND` in
  CI's "Smoke the built binaries" step on main. The root build is now
  `tsdown && pnpm --filter @tau/tui build && pnpm --filter @tau/webui
build`: unified tsdown keeps building the nine engine packages + CLI
  from their own configs, and each vite app runs its own build, so the
  pre-PR gate and CI exercise the full 11-package tree again. (#33)

- **Installed `tau` bins no longer silently no-op.** The "am I the entry
  module?" guard in `@tau/cli`, `@tau/tui` and `@tau/webui` compared
  `import.meta.url` against the raw `process.argv[1]`; every installed
  binary runs through a symlink (npm/pnpm `.bin` shims, `pnpm link
--global`), where `argv[1]` is the link path while Node reports the
  module under its real path — the comparison never matched, and the
  command exited 0 with zero output (found by the pack smoke test while
  unblocking #23; also affected the documented dev install
  `pnpm --filter @tau/cli link`). The guards now resolve `argv[1]`
  through `realpathSync` before comparing. Regression test: symlinked
  `dist/index.js` → `tau --version` must print the version.

- **`--yes` now honors the medium-risk policy for tool steps.** The per-step
  risk derivation in `runPlan()` hard-coded `low` for every tool step, so
  `tau ask "<intent>" --yes` silently executed medium-risk tool steps
  (`file.rename`, `text.replace`, every `plugin.*` MCP tool) even with the
  default `allowMediumAutoApprove: false` — contradicting the documented
  contract ("--yes auto-approves low; medium only with the opt-in config;
  never high/blocked"). Tool steps now carry their tool's intrinsic risk
  (unknown tools derive `blocked`), so under `--yes` a medium-risk tool step
  waits for the opt-in config or an interactive confirmation, and a
  high-risk tool step (e.g. a skill-declared one) is skipped exactly like a
  high-risk shell step. The WebUI flow is unchanged (its explicit
  request-as-approval doctrine already set `autoApproveAll`), the TUI is
  unchanged (it confirms interactively before executing). CLI `--yes` help
  text and both README quick-start glosses updated to state the real policy.
  Tests: medium-refused / medium-opted-in / low-benign-lookalike /
  high-risk-tool pairs.

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
- **Stale references repaired across the agent docs.** The dev-workflow
  skills still pointed at the pre-rename `AGENTS.d/` rulebook directory
  (`tau-test`, `tau-release`, `tau-skill-new`) and at pre-monorepo paths
  (`tests/unit/skills.test.ts`, `tests/integration/cli.test.ts`, the bundled
  scope written as `<package>/skills/`, "PR against `skills/`"); all now
  point at current locations.
- **Release checklist commands updated for the pnpm monorepo**
  (`AGENTS/release.md` + the `tau-release` skill): the version bump happens
  inside `app/cli/` (the published `@tau/cli`), `pnpm pack` produces
  `tau-cli-<ver>.tgz` — not the single-package-era `tau-tool-<ver>.tgz` —
  and build verify uses `app/cli/dist/index.js`. The pack/publish smoke
  test is explicitly marked **blocked** with a pointer to the packaging
  issue (#23): the tarball cannot be installed outside the workspace while
  `@tau/*` dependencies use the `workspace:*` protocol.

### Added

- **WebUI Tools view — the tool layer, on screen.** The reference rail gains
  a third tab next to Skills and History: every registered tool (built-in
  `file`/`sys`/`net`/`text` families plus skill-owned tools) with its
  intrinsic risk badge, owning skill, description, and its parameter spec
  (`name type` chips, `*` marks required). Backed by a new read-only
  `GET /api/tools` route and a `listToolSummaries()` session service in
  `@tau/agent` (catalog built on demand; the serialized shape is pure data —
  the registry's `run` executables never leave the process). Tests in the
  agent and webui suites assert the shape and the no-executables guarantee.

- **AI collaboration operating norms** (`AGENTS/collaboration.md`, normative
  in Chinese). Transcribes the maintainer's collaboration contract into the
  repo's must-read chain: systematic project understanding before code;
  Issue-first with one-PR-per-Issue (`Closes #N`); standalone dependency PRs
  with audit + test reports; doc sync in the same PR; `[REFACTOR]` /
  `[ARCHITECTURE]` PR tags with structure-impact statements; "此 PR 由 AI 生成"
  in AI PR bodies plus the `AI-Generated:` commit prefix line (alongside the
  existing `AI-declaration:` block); a CHANGELOG fragment in every PR;
  `AGENTS.md`/`.claude/skills/` update duties; AI never merges (human review
  mandatory, extra approval for architecture/safety PRs); CI compliance and
  traceability. Wired into AGENTS.md (mandatory-read notice + index),
  CLAUDE.md, CONTRIBUTING.md, AGENTS/release.md, `.gitmessage` and the PR
  template (structure-impact section + AI note).

- **CI gate workflow** (`.github/workflows/ci.yml`). CONTRIBUTING.md claimed
  "CI runs the same gate" — now it actually does: every push to `main` and
  every PR runs the frozen-lockfile install, `pnpm lint`, `pnpm format:check`,
  `pnpm typecheck`, `pnpm build` (plus a built-binary smoke test), coverage-
  thresholded `pnpm test:cov`, and a production dependency audit. CI is a
  floor, not an approver: merge still requires human review. Both READMEs
  gained the CI badge.

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

- **WebUI client rebuilt as a design system** ("terminal precision"),
  replacing the prototype single-file frontend. The 370-line `App.vue` is
  now a slim shell over `client/components/` (StatusHeader, PlanCard /
  StepRow, ResultCard, ErrorCard, SidePanel, Composer, RiskBadge,
  EmptyState), `client/composables/` (module-singleton state — no state
  library), and `client/lib/` (typed API client, formatters). The visual
  language is derived from the product domain instead of dashboard
  templates: the risk levels are the one semantic color system (green /
  amber / red / dim, every risk indicator through `RiskBadge`), data renders
  in monospace and prose in system sans, and gradients, shadows and emoji
  are banned. Layout is adaptive — ≥1024px chat column + reference rail
  with independent scrolling, below that a single flow with a sticky
  composer, compact two-row header under 640px. Motion is restrained and
  honest: 120–180ms color/border micro-transitions, staggered fade-rise
  card entrances, a sliding tab indicator, a single pulsing dot as the only
  running state (no fake progress), all disabled under
  `prefers-reduced-motion`. Data the old UI ignored is now surfaced: plan
  explanations, per-step reasons, history timestamps/step counts, provider
  model, version and plugin counts. The high-risk confirmation is
  card-local state — the old global `#confirm-high-risk` DOM id collided
  across concurrent plan cards. Normative design spec lives in the new
  tool-layer skill `app/webui/SKILL.md` (`tau-webui-design`); the L2 layer
  definition in `AGENTS/skills.md` now covers `app/<app>/SKILL.md`.
  Server-side, only an additive read-only route changed (see the Tools
  entry under Added); the execution gate is untouched.

- **Packaging unblocked: the `@tau/*` family now ships together.** Resolves
  the structural gap tracked in #23: the packed `@tau/cli` tarball could not
  be installed outside the workspace (`pnpm pack` rewrites the `@tau/*`
  `workspace:*` dependencies to their workspace versions, and `npm install`
  then 404s on the unpublished scoped packages — `@tau/agent@0.1.0`, verified
  2026-08), so release-checklist steps 5-6 were marked blocked. Decision
  (evidence table in #23): **family publishing** via `pnpm publish -r` —
  bundling the siblings into the CLI would break `@tau/webui`'s
  `import.meta.url`-based client-asset resolution and the MCP SDK
  optional-dependency boundary, and GitHub Releases distribution conflicts
  with the documented npm publish goal. Concretely: all 11 publishable
  workspace packages now declare `publishConfig: { access: "public" }`
  (scoped packages refuse to publish without it); the release checklist
  bumps every package in lockstep and publishes with `pnpm publish -r`,
  which rewrites `workspace:*` and `catalog:` specifiers to real versions
  on the fly (verified on packed tarballs); the pack smoke test installs
  the whole tarball family into a scratch project and exercises the `tau`
  bin before any registry publish. `AGENTS/release.md` and the
  `tau-release` skill document the unblocked flow.

- **SKILL.md files now follow a three-layer placement model** — L1 root
  dev-workflow skills, L2 package tool-layer skills, L3 shipped product
  content (normative in `AGENTS/skills.md` "SKILL.md files in THIS repo" and
  the governance table in `AGENTS/architecture.md`). The `tau-skill-new`
  skill's content moved into the new tool-layer skill
  `packages/skills/SKILL.md` (`tau-skills-authoring`, versioned with
  `@tau/skills`); the root skill remains as a thin router with unchanged
  trigger description. `AGENTS/collaboration.md` §8 now also covers
  package-level skills. Documentation-only — no runtime code touched.

- **Directory governance codified; stale skill paths repaired.** New
  normative "Directory governance" table in `AGENTS/architecture.md` (human
  summary in `docs/architecture.md`) spelling out what lives at the repo
  root versus inside `packages/skills/` versus runtime `$TAU_HOME`: AI
  behavior rulebooks at root (`AGENTS.md`, `AGENTS/`), AI dev-workflow
  skills at root (`.claude/skills/*/SKILL.md` — this repo has no root
  SKILL.md), shipped skills + `tau skill new` scaffold inside
  `packages/skills/` (`bundled/`, `templates/` — runtime-resolved via
  `packageRoot()`, never relocated casually), and user-scope skills under
  `$TAU_HOME` / workspace scopes only. Fixed the broken README links to the
  bundled skill examples (`skills/git-helper/...` →
  `packages/skills/bundled/...` in both languages), the stale
  `skills/<name>/SKILL.md` path in AGENTS/architecture.md, the tsdown
  workspace description in AGENTS/conventions.md (now
  `packages/* + app/cli`, UI apps on vite), and the frozen-runtime-deps
  wording for commander. CONTRIBUTING dev-workflow commands updated for the
  vite-based UI apps.

- **`@tau/webui` rebuilt on Vite + Vue 3 + UnoCSS.** The local web
  interface keeps its zero-dependency `node:http` API server
  (`src/server.ts`) but replaces the vanilla static frontend with a Vue 3
  single-file client (`client/App.vue`) styled by UnoCSS (`uno.config.ts`,
  `presetWind3` theme tokens + shortcuts). Build is vite end-to-end:
  client → `dist/client/` (served statically by the node server, with the
  raw `client/` sources as dev/test fallback) and the `tau-web` bin via a
  node/SSR vite config with the same shebang-keeping plugin as the TUI.
  Dev mode: `vite dev` proxies `/api/*` to the engine server on :8787. The
  `tau web` commander wiring moved into `@tau/cli` (`app/cli/src/web.ts`),
  so `@tau/webui` no longer imports commander at all — the phantom
  dependency is gone by construction, not by declaration. vue /
  @vitejs/plugin-vue / unocss are dev-only (the client bundle ships
  self-contained). User-visible behavior is unchanged; the API gained
  additive fields (provider.model, plugins, skills.risk/origin) from the
  shared session services. Root READMEs/AGENTS map wording updated.

- **`@tau/tui` builds with vite.** The interactive terminal app now uses
  vite (v8, node/SSR mode, `app/tui/vite.config.ts`) for build and
  `vite build --watch` for its dev loop; the unified tsdown workspace build
  narrows to `packages/* + app/cli`. Vite does not guarantee bin shebangs,
  so a small `tau-bin-shebang` plugin re-adds `#!/usr/bin/env node` and
  marks `dist/index.js` executable (verified by smoke test). Output and
  runtime behavior are unchanged: `@tau/*` siblings stay external, source
  runs via `tsx --conditions=development` are unaffected. Rationale: one
  frontend toolchain across the two UI apps (WebUI follows), per the
  maintainer's tooling directive. `.claude/skills/tau-build` updated to
  describe the split build.

- **Shared UI session services in `@tau/agent`.** The facts and flows that
  the two interactive front doors (TUI REPL, WebUI server) both present and
  drive now live in one place: `packages/agent/src/session.ts` exports
  `getActiveProvider()`, `listProviderAvailability()`, `listSkillSummaries()`,
  `readRecentHistory()`, `getSessionInfo()` (one async status snapshot:
  version, TAU_HOME, provider + model, provider availability, skill/plugin
  counts), `ensureCatalog()` (once-per-process catalog bootstrap) and
  `planAndReview()` (intent → plan → deterministic safety review). `tau tui`
  consumes them for `/provider` `/skills` `/history` `/status` and the intent
  flow; `tau web` serves the same sources over `/api/*` (the status payload
  additionally reports `provider.model` and `plugins`, and `/api/skills`
  entries now include `risk` and `origin` — additive, clients unaffected).
  Deduplicates catalog bootstrap, status assembly and the double
  `reviewPlan()` call the two apps previously ran independently. No
  execution-path change: plans still run exclusively through `runPlan()`.

- **pnpm catalog adoption — one source of truth for dependency versions.**
  All 29 external dependency specifiers across the root and the 11 workspace
  packages now read `catalog:` from a single block in `pnpm-workspace.yaml`
  (runtime deps, optional SDKs, toolchain), so version drift between packages
  is impossible by construction and a version bump is a one-line change.
  `pnpm-lock.yaml` regenerated (`--frozen-lockfile` verified); no version was
  added, removed, upgraded or downgraded in the process — the lockfile
  resolves to the exact same package set as before. `pnpm audit` clean.

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
