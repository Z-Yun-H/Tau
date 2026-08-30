# AGENTS/conventions.md — TypeScript rules for this repo

## Workspace rules (pnpm monorepo)

- The repo is a pnpm workspace: UI apps in `app/*`, engine packages in
  `packages/*` (see `pnpm-workspace.yaml`). Cross-package imports use the
  `@tau/*` name of a package declared in that package.json with `workspace:*`
  and import from its barrel (`@tau/core`), never deep paths.
- Each package exports its public API from `app/cli/src/index.ts`. Its package.json
  `exports` maps `types`/`development` to TypeScript source (so tsc and
  `tsx --conditions=development` run from source) and `import`/`default` to
  `dist/index.js` (so built apps resolve real artifacts).
- Dependency direction (no cycles): `core ← tools ← engine ← skills`;
  `core+tools ← ai|plugins`; all of the above feed `@tau/agent`; apps
  (`@tau/cli`, `@tau/tui`, `@tau/webui`) sit on top. Adding an import that
  would create a cycle means the code is in the wrong package — move it.
- Runtime deps belong in the package that imports them (see AGENTS.md rule 4);
  test-only deps are devDependencies of that same package.
- Build: `pnpm build` runs tsdown in every package in topological order. tsdown
  externalizes all declared deps (workspace siblings are never bundled into
  each other); optional SDKs (`@modelcontextprotocol/*`, `@deepseek-ai/*`) are
  pinned via that package's `deps.neverBundle`.

## Style baseline

- oxfmt owns formatting (`.oxfmtrc.json`, `pnpm format`); do not
  hand-format. `templates/` is in its `ignorePatterns` so `{{placeholders}}`
  survive — never remove that entry.
- oxlint owns linting (`.oxlintrc.json`, Rust-based, single binary);
  `pnpm lint:fix` before pushing. Safety-critical regexes may carry an
  inline `// oxlint-disable <rule>` block with a WHY comment — see
  `packages/tools/src/tools/net.ts` (SSRF guard) for the pattern.
- 2-space indent, double quotes, trailing commas, LF, 100 cols.
- `strict: true` + `noUncheckedIndexedAccess: true` — code accordingly:
  - array access returns `T | undefined`: use `arr[i] ?? fallback`, never `!`
    (the only allowed `!` is on `plan.steps[i]!` inside a `for (let i...)`
    loop that just checked `i < plan.steps.length` — and preferably map first).
- `verbatimModuleSyntax: true` — type-only imports MUST use
  `import type { X } from ...`.
- ESM only. Relative imports keep the `.js` extension pattern for runtime
  clarity under tsdown (`.js` resolves to compiled output; rolldown rewrites).
  Wait — we build with `moduleResolution: "Bundler"`, so relative imports
  WITHOUT extension also typecheck. Convention in this repo: **keep the
  `.js` extension** on relative imports (matches tsc NodeNext muscle memory
  and works fine under rolldown/vitest).

## Naming

| Thing            | Convention                         | Example                                      |
| ---------------- | ---------------------------------- | -------------------------------------------- |
| files            | lowercase, dot separates role      | `providers/mock.ts`, `cli/ask.ts`            |
| tools            | dotted `family.verb`               | `file.find`, `sys.proc`, `git-helper.status` |
| skill names      | kebab-case                         | `git-helper`                                 |
| CLI flags        | long kebab flags + short where hot | `--execute / -e`                             |
| types/interfaces | PascalCase, no `I` prefix          | `PlanStep`                                   |
| errors           | throw `Error` with human sentence  | `throw new Error("port must be...")`         |

## Error handling

- Tool handlers may THROW; `executeStep` and `runToolDirect` catch and render.
  Write error messages for the terminal user: imperative, specific, no jargon.
  Good: `Refusing to fetch private address 127.0.0.1 by default (pass allowPrivate:true to override)`
  Bad: `invalid host`.
- Exit codes: 0 ok, 1 generic failure, 2 denied-by-safety. Keep consistent.
- Never `process.exit()` inside library code — set `process.exitCode` in CLI
  actions only.

## Output

- All user-facing color goes through `packages/ui/src/ui/theme.ts` — never raw chalk in
  modules below `ui/` (providers return plain text; the CLI adds color).
- Tools return PLAIN text (no ANSI). History stores plain text.
- Tables/lists: simple padded strings are fine; no table dependency.

## Comments & docs

- Comments explain WHY, not WHAT. If you need a WHAT comment, the code is
  probably fine without it.
- Every public function in `core/`, `ai/`, `tools/` gets a 1-3 line doc
  comment. `packages/core/src/types.ts` doc comments are the API reference — keep them true.
- Comments may be English; keep one language per file.

## Dependency policy

Runtime deps are frozen at: commander, chalk, yaml, zod. Adding a runtime dep
requires: (a) justification in the PR, (b) update to AGENTS.md golden rule 4
and AGENTS/architecture.md, (c) no better stdlib alternative
(`node:fs/promises`, `node:os`, `node:net`, `fetch` cover 90% of needs).

Dev deps are freer, but keep install time reasonable; no monolithic toolchains.

## Platform support

Primary: Linux + macOS. Windows: best-effort (sys.proc degrades with a
message; ping uses `-n`). Guard platform-specific code explicitly with
`process.platform` checks and a helpful fallback message, never silently.
