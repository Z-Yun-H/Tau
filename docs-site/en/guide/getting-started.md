# Installation & quick start

Tau is an AI assistant that lives in your terminal: you state an intent in natural language, it produces a structured plan, the plan passes a deterministic safety review and waits for your approval before anything runs. It is not "AI typing commands" — it is "AI proposes, rules review, you decide".

## Install

Tau is a pnpm monorepo; run or build from source:

```bash
git clone https://github.com/Z-Yun-H/Tau.git
cd Tau
pnpm install
pnpm build

# pipe-friendly mode (CLI)
pnpm dev -- file find "*.ts"

# multi-round agent mode
pnpm dev -- goal "organize all .bak files under src into a cleanup dir"
```

## Three front doors

| Mode  | Command              | Best for                                      |
| ----- | -------------------- | --------------------------------------------- |
| CLI   | `tau ask "<intent>"` | pipes, scripts, one-shot answers              |
| TUI   | `tau tui`            | full-screen keyboard flow                     |
| WebUI | `tau web`            | thinking panels and tool cards in the browser |

All three share the same engine and the same safety gate — the review verdict you see in the WebUI is exactly the one the CLI prints.

## Configure a provider

Tau needs at least one AI provider to plan:

```bash
tau config set providers.deepseek.apiKey "sk-..."
tau config set provider deepseek
```

No network yet? The built-in `mock` provider emits deterministic plans and reasoning traces — the entire pipeline (including the WebUI streaming thinking panel) demos offline.

## The safety model in 60 seconds

Three things happen before anything executes: **plan** (the provider emits a strict-JSON step list) → **review** (deterministic code, never AI self-grading) → **confirm** (high-risk steps demand explicit approval). `runPlan()` is the only execution channel; there is no bypass. See the [safety model](/en/reference/safety).
