---
name: {{name}}
version: 0.1.0
description: {{description}}
author: your-name
tags: []
risk: low
triggers: []
commands: []
---

<!-- ===== Everything below is shown to humans AND to the AI planner ===== -->

# {{name}}

## What this skill does

Describe the capability in 2-4 sentences. The `description` field above is what
the AI planner matches against user intent — make it specific ("Format Rust
code with cargo fmt + clippy auto-fix", not "Rust things").

## How to use (human)

```bash
tau skill show {{name}}
tau skill validate {{name}}
```

## How to extend (AI)

Add declarative commands to the frontmatter. Keep them low-risk; anything
destructive must stay OUT of skills and rely on reviewed shell plans instead.

```yaml
commands:
  - name: lint
    description: Run ESLint over src/ and tests/
    command: npm run lint --silent
    risk: low
```

Use `{args}` placeholders for positional values (filled from the `values`
argument): `command: grep -rn {args} .`

## Scripts (optional)

Put helper scripts in `scripts/`. They are plain files — Tau does not execute
them automatically; reference them from declarative commands with absolute
care, e.g. `node {{dir}}/scripts/main.mjs` at your own risk.
