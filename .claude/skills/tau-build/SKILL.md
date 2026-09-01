---
name: tau-build
description: Build and typecheck the Tau CLI project. Use whenever you changed TypeScript source and need to verify it compiles and bundles before committing.
---

# Build Tau

Run the build pipeline in order. Each step must pass before the next:

```bash
pnpm typecheck      # tsc --noEmit — all TypeScript in src/ and tests/
pnpm lint           # oxlint (.oxlintrc.json)
pnpm build          # unified tsdown workspace build (packages/* + app/cli)
node app/cli/dist/index.js --help   # verify the bundle actually runs
```

`@tau/tui` and `@tau/webui` build with **vite** (node/SSR mode), not tsdown:
`pnpm --filter @tau/tui build && pnpm --filter @tau/webui build` — both must
still produce a runnable `dist/index.js` starting with `#!/usr/bin/env node`.

## Expectations

- `dist/index.js` starts with `#!/usr/bin/env node`.
- Build is clean: the only intentional externals are the optional,
  dynamically-imported SDKs — `@deepseek-ai/*` and `@modelcontextprotocol/*`
  via `deps.neverBundle` in their packages' tsdown configs, and
  `z-ai-web-dev-sdk` (external because its import specifier is a runtime
  variable in `packages/ai/src/providers/zai.ts`, not a config entry).
- If typecheck fails on `noUncheckedIndexedAccess`, fix the code (add `??`
  fallbacks) — do NOT loosen tsconfig.

## Common fixes

| Symptom                                | Fix                                                             |
| -------------------------------------- | --------------------------------------------------------------- |
| `Cannot find module './x.js'`          | relative import missing `.js` extension (repo convention)       |
| typecheck passes, runtime import error | check tsdown `deps.neverBundle` and package `type: module`      |
| chalk colors in tests                  | provider/tool code must return plain text; color only in cli/ui |
