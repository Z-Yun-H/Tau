---
name: tau-docs
version: 0.1.0
description: Documentation-site construction and development for Tau — VitePress workspace at docs-site/ with zh (default) + en locales. Use when adding/updating docs pages, changing nav/sidebar, or syncing docs content with product features.
author: Tau maintainers
tags: [docs, vitepress, tau, workflow]
risk: low
---

# tau-docs — documentation site workflow

The docs site is a **private workspace member** (`docs-site/`, package
`@tau/docs-site`) — content, never runtime data; the CLI never reads from
it. Normative placement: the directory governance table in
[AGENTS/architecture.md](../../../AGENTS/architecture.md).

## Commands

| Task                          | Command             |
| ----------------------------- | ------------------- |
| Local dev server (hot reload) | `pnpm docs:dev`     |
| Production build              | `pnpm docs:build`   |
| Preview the production build  | `pnpm docs:preview` |

Build output goes to `docs-site/.vitepress/dist/` (gitignored). The docs
build is NOT part of the `pnpm build` gate — run `pnpm docs:build` explicitly
when you touched the site.

## Layout

```
docs-site/
  .vitepress/config.mts   nav + sidebar + locales (zh root, en under /en/)
  index.md                zh home (hero + features)
  guide/                  zh guides — one page per user-facing surface
  reference/              zh reference — one page per architecture concern
  en/                     en mirror: en/index.md, en/guide/, en/reference/
```

## The content-decomposition contract (issue #111)

Docs pages decompose from the PROJECT'S FEATURE MAP, not from the repo
tree. The stable mapping:

| Product surface     | Guide page (zh / en identical names) |
| ------------------- | ------------------------------------ |
| first run & install | `guide/getting-started.md`           |
| `tau ask`           | `guide/ask.md`                       |
| `tau goal`          | `guide/goal.md`                      |
| built-in tools      | `guide/tools.md`                     |
| providers           | `guide/providers.md`                 |
| skills              | `guide/skills.md`                    |
| plugins (MCP)       | `guide/plugins.md`                   |
| WebUI               | `guide/webui.md`                     |
| TUI                 | `guide/tui.md`                       |
| config              | `guide/config.md`                    |

Reference pages (architecture / safety / provider-dev / skill-authoring)
mirror the normative deep dives in `AGENTS/*.md` — the docs site is the
user-facing narrative; AGENTS stays the normative rulebook. **Same rule
defined in two places is a bug**: the site narrates and links, AGENTS
norms.

## Rules

1. **Every zh page has an en mirror** with the same filename under `en/`.
   A one-sided page is an incomplete change; ship both or neither.
2. **Nav/sidebar lives in `config.mts`** — adding a page means adding its
   sidebar entry for BOTH locales in the same change.
3. **Feature changes update docs in the same PR** (same contract as the
   READMEs): new capability → new section on the mapped guide page; new
   CLI flag → the page for that command.
4. **Language**: zh pages are 简体中文, en pages are English — never mix
   within a page. Code blocks stay code.
5. **No invented facts**: document what the code does (verify against
   source/AGENTS before writing); numbers (caps, defaults) must match the
   implementation.

## Checklist before finishing

- [ ] `pnpm docs:build` passes (both locales, dead links fail the build)
- [ ] zh + en pages both exist and are linked in both sidebars
- [ ] facts verified against the implementation (defaults, caps, flags)
- [ ] AGENTS/*.md remains the normative source — the site narrates, not re-specifies
