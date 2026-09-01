# WebUI run screenshots

PNGs from a **real end-to-end session**: the actual HTTP server
(`startWebUi`) against a `TAU_HOME` sandbox with the mock provider, driven
through the actual client in headless Chromium (playwright-core). No
network, no AI keys.

| file         | what it shows                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `plan.png`   | the reviewed plan card — risk badge, explanation, the `file.find` step, Run plan / Discard actions |
| `result.png` | the streaming result card (`ok · 1 ok`) with the rendered output — the NDJSON stream rendered live |

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
