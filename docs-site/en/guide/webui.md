# Web UI

`tau web` starts the local web interface (default `127.0.0.1:8787`, never exposed to the network): plan cards, thinking panels and live tool calls in the browser, backed by the exact same engine and safety gate as the CLI.

```bash
tau web
```

## Two modes

- **plan mode**: intent → plan card → review badge → you press Run → live result card. High-risk plans get a card-local explicit checkbox; deny verdicts hard-disable Run.
- **agent mode**: a multi-round goal timeline. Each round shows its plan, review badge and live step output; medium+ rounds pause inline with Approve / Refuse on the card — never a blanket pre-approval.

## Thinking panels (v0.5.0)

While planning, the provider's reasoning streams into a collapsible panel (pinned open while streaming, collapsed to "Thought for Ns" when done); in agent mode each round's planning and reflection thinking collapse into their own rounds. Token usage shows in the card eyebrow.

## Tool call cards and the file viewer (v0.5.0)

Tool steps in agent rounds render as structured cards: tool name, risk badge, collapsible args JSON, live output. `file.read` steps render as a file viewer instead — path, language chip and a shiki-highlighted body, with language detection shared with the tool layer.

## Local sessions

Conversation threads persist in browser localStorage (key `tau-webui-threads-v1`, cap 50); the server history is the durable record; the card schema is additive-only. The settings panel shows the **redacted** effective config (API keys are always masked) — config modification stays in the CLI, the browser is never a second write path into safety-relevant configuration.
