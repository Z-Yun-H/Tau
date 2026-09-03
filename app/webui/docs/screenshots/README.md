# WebUI run screenshots

PNGs from a **real end-to-end session**: the actual HTTP server
(`startWebUi`) against a `TAU_HOME` sandbox with the mock provider, driven
through the actual client in headless Chromium (playwright-core). No
network, no AI keys.

| file              | what it shows                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plan.png`        | the reviewed plan card (v0.5.0 streaming) — collapsed thinking disclosure, risk badge, explanation, the `file.find` step, Run plan / Discard actions                     |
| `thinking.png`    | the expanded thinking panel — the mock provider's reasoning body (`reasoning_delta` relay), one click away from the collapsed summary                                    |
| `result.png`      | the streaming result card (`ok · 1 ok`) with the rendered output — the NDJSON stream rendered live                                                                       |
| `tools.png`       | the Tools reference rail — catalog overview (N tools · N read · N mutates · N dry-run), family groups with counts, MUT/READ/DRY kind tags                                |
| `settings.png`    | the read-only settings panel (v0.3.0): effective config, provider availability chips, risk policy, theme picker, session stats — `GET /api/config` rendered              |
| `agent.png`       | agent mode (v0.4.0): the multi-round goal card — round timeline with live-streamed steps, per-round risk badges, the final answer, and the composer's plan\|agent switch |
| `file-viewer.png` | agent mode (v0.5.0): a goal whose round plans `file.read` — per-round thinking panel plus the structured tool call card with the shiki-highlighted file viewer           |

## Regenerate

```bash
pnpm install                      # playwright-core comes from the catalog
pnpm --filter @tau/webui build    # the client must be built first
pnpm --filter @tau/webui shots
```

Chromium resolution order: `$TAU_CHROMIUM` → newest `chromium-*` build in
`~/.cache/ms-playwright` → playwright-core's registry default. One-time
browser install: `pnpm dlx playwright@1.57.0 install chromium`. The tool
lives at [`app/webui/scripts/screenshot.mjs`](../../scripts/screenshot.mjs).
