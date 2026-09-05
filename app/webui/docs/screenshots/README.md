# WebUI run screenshots

PNGs from a **real end-to-end session**: the actual HTTP server
(`startWebUi`) against a `TAU_HOME` sandbox with the mock provider, driven
through the actual client in headless Chromium (playwright-core). No
network, no AI keys.

| file                        | what it shows                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan.png`                  | the reviewed plan card (v0.5.0 streaming) — collapsed thinking disclosure, risk badge, explanation, the `file.find` step, Run plan / Discard actions                            |
| `thinking.png`              | the expanded thinking panel — the mock provider's reasoning body (`reasoning_delta` relay), one click away from the collapsed summary                                           |
| `result.png`                | the streaming result card (`ok · 1 ok`) with the rendered output — the NDJSON stream rendered live                                                                              |
| `tools.png`                 | the Tools reference rail — catalog overview (N tools · N read · N mutates · N dry-run), family groups with counts, MUT/READ/DRY kind tags                                       |
| `settings.png`              | the read-only settings panel (v0.3.0): effective config, provider availability chips, risk policy, theme picker, session stats — `GET /api/config` rendered                     |
| `agent.png`                 | agent mode (v0.4.0): the multi-round goal card — round timeline with live-streamed steps, per-round risk badges, the final answer, and the composer's plan\|agent switch        |
| `file-viewer.png`           | agent mode (v0.5.0): a goal whose round plans `file.read` — per-round thinking panel plus the structured tool call card with the shiki-highlighted file viewer                  |
| `command-menu.png`          | composer `/` floating menu (v0.6.0) — the shared catalog single-sourced from `GET /api/commands`, ↑/↓ move · tab/enter run · esc dismisses                                      |
| `command-menu-filter.png`   | typing narrows the menu live (`th` → /theme) (v0.6.0)                                                                                                                           |
| `attachments.png`           | composer attachment chips (v0.6.0) — picked/dropped/pasted images pass the magic-number gate, thumbnails decode before send                                                     |
| `attachments-sent.png`      | the sent user card + plan review carrying the chips (v0.6.0)                                                                                                                    |
| `html-preview.png`          | result card (v0.6.0): a generated ```html block rendered inside the sandboxed opaque-origin iframe (stream harness — see below)                                                 |
| `image-view.png`            | agent goal (v0.6.0): the ToolCallCard native image view streamed through `GET /api/file`                                                                                        |
| `image-viewer-card.png`     | the same viewer card, element-cropped (v0.6.0)                                                                                                                                  |
| `provider-setup.png`        | settings (v0.7.0): deepseek picked — the endpoint is looked up from the server catalog (`https://api.deepseek.com`), the key console is one link away, the key input waits      |
| `provider-setup-key.png`    | the pasted key masked (password dots) — the privacy default (v0.7.0)                                                                                                            |
| `provider-setup-reveal.png` | explicit peek: the key in plaintext + "hide" — the toggle re-masks itself after 8s (v0.7.0)                                                                                     |
| `provider-setup-saved.png`  | after save: the server's `sk-***last4` mask, the `·key` chip on the provider, the input cleared, plaintext gone (v0.7.0)                                                        |
| `provider-setup-card.png`   | the provider setup section, element-cropped (v0.7.0)                                                                                                                            |
| `viewport-lock.png`         | the fixed-height shell (v0.7.0): a three-request thread scrolls inside the stream column, the third card clipped by the fold, the composer pinned — the page itself never grows |

## Regenerate

```bash
pnpm install                      # playwright-core comes from the catalog
pnpm --filter @tau/webui build    # the client must be built first
pnpm --filter @tau/webui shots    # v0.3.0–v0.5.0 surfaces (plan/thinking/result/…)
pnpm --filter @tau/webui shots:v060   # v0.6.0 surfaces (command menu/attachments/previews)
pnpm --filter @tau/webui shots:v070   # v0.7.0 surfaces (provider setup/viewport lock)
```

Chromium resolution order: `$TAU_CHROMIUM` → newest `chromium-*` build in
`~/.cache/ms-playwright` → playwright-core's registry default. One-time
browser install: `pnpm dlx playwright@1.57.0 install chromium`. The tools
live at [`app/webui/scripts/screenshot.mjs`](../../scripts/screenshot.mjs),
[`app/webui/scripts/shot-v060.mjs`](../../scripts/shot-v060.mjs) and
[`app/webui/scripts/shot-v070.mjs`](../../scripts/shot-v070.mjs).

One honesty note: the offline mock never emits html fences, so the
`html-preview` scene is the one place `shot-v060.mjs` intercepts a stream
(`page.route` on `/api/execute/stream`) and injects a payload carrying an

```html block — the shipped client pipeline (renderMarkdown →
attachHtmlPreviews → sandboxed iframe) then runs for real. Every other scene across all three
harnesses is fully end-to-end: `shot-v070.mjs` needs no interception at all — its provider save goes
through the actual `POST /api/config/provider` into the `TAU_HOME` sandbox (0600 config, deleted
afterwards; the demo key is made-up), and the viewport-lock scene asserts on stdout that the page
never scrolls (`pageScrollHeight == innerHeight`) while the stream column overflows.
```
