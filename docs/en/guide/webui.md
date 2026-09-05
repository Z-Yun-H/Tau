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

## Slash command menu (v0.6.0)

Typing `/` (or a prefix like `/th`) in the composer opens a floating command menu — `↑`/`↓` move, `Tab`/`Enter` run, `Esc` dismisses; mouse hover/click work too. Commands execute CLIENT-side (`/new` thread, `/theme`, `/plan`, `/agent`, `/help`, `/settings`, …) and are **never sent to the AI as intents**; the menu reads the same shared command catalog as the TUI palette (served via `GET /api/commands`), so what is shown can never drift from what runs.

## Image attachments (v0.6.0)

The paperclip button, clipboard paste and drag-and-drop all feed one validated draft list: PNG/JPEG/WebP/GIF, up to 4 images, max 4 MB each; drafts render as removable preview chips, and sending images without text uses an explicit default intent. Payloads ride the request only — user cards keep name/type/size meta (thumbnails are session-only), and nothing image-shaped ever enters the NDJSON event stream or localStorage. Vision-capable providers (openai/anthropic/gemini/ollama) receive the images in their native wire shape; text-only providers get an honest "image was dropped" annotation instead of pretending to see. The server re-validates independently: media-type whitelist, count/size caps, and a magic-number probe (a renamed text file cannot masquerade as an image).

## Sandboxed previews and native viewing (v0.6.0)

- **HTML preview**: ```html fenced blocks in results/goal answers gain a preview toggle — the code opens in an `<iframe sandbox="allow-scripts">` (no allow-same-origin; an opaque origin cannot touch the parent page, cookies or storage). The escape-first markdown pipeline is untouched — the preview is a separate sandbox channel.
- **PDF / image native viewing**: `file.read` of a PDF or an image no longer shows binary-as-text — the file streams through the read-only `GET /api/file` route into the browser's native viewer (`<embed>` / `<img>`). The route is workspace-contained (reusing the write tools' own containment helpers plus a realpath re-check that closes symlink escape), size-capped at 8 MB, serves a conservative mime whitelist (never html/js/svg or anything executable), and answers 403/404/413 with plain JSON.

## Local sessions

Conversation threads persist in browser localStorage (key `tau-webui-threads-v1`, cap 50); the server history is the durable record; the card schema is additive-only. The settings panel shows the **redacted** effective config (API keys are always masked).

## Provider setup (v0.6.1)

The settings panel gains a **provider setup** block — the ONE writable config slice:

- **Model link lookup**: picking a provider prefills the endpoint (from a server-sent catalog that is parity-checked against the live provider registry) — no URL typing; an advanced disclosure allows a custom endpoint (OpenAI-shaped providers write `providers.<name>.baseUrl`, Ollama writes `host`).
- **Paste-only key**: follow the per-provider console link, paste the key, save — through `POST /api/config/provider`, the same `setConfigValue` channel `tau provider set-key` uses (chmod-0600 config file). Saving also refreshes the model catalog and can activate the provider in one step (keyless mock/ollama/zai need no key).
- **Privacy masking**: the key input is a `password` field; the "show" toggle re-masks itself after 8 seconds; a saved key renders only as the server's mask (`sk-***last4`) — plaintext exists only in the localhost request body and the 0600 config file, never echoed, never logged. The gate and risk policy remain **immutable** from the browser.
