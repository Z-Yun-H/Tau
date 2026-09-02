/**
 * Observability baseline tests (issue #98) — the request log (injected
 * sink): line format, notes (token usage), the quiet switch, and the
 * /api/plan usage field.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tauHome } from "@tau/core";
import { ensureCatalog } from "@tau/agent";
import { startWebUi } from "../src/server.js";
import type { RunningWebUi } from "../src/server.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";
let ui: RunningWebUi;
let lines: string[];

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-obs-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  process.env["TAU_WEBUI_QUIET"] = "1";
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  ensureCatalog();
  lines = [];
  ui = await startWebUi({ port: 0, log: (line) => lines.push(line) });
});

afterEach(async () => {
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  delete process.env["TAU_WEBUI_QUIET"];
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("request log", () => {
  it("logs one line per request with method, path, status and duration", async () => {
    const res = await fetch(new URL("/api/status", ui.url));
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.* GET \/api\/status -> 200 \d+ms$/);
  });

  it("logs 404s for unknown routes with the same shape", async () => {
    const res = await fetch(new URL("/api/definitely-not-here", ui.url));
    expect(res.status).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("GET /api/definitely-not-here -> 404");
  });

  it("annotates /api/plan with the provider's token usage", async () => {
    const res = await fetch(new URL("/api/plan", ui.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "find all *.md files" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    };
    // The mock provider reports synthetic usage — it must surface in the
    // response AND the log note (issue #98: never dropped silently again).
    expect(body.usage).toBeDefined();
    expect(body.usage?.totalTokens).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lines[0]).toContain("/api/plan -> 200");
    expect(lines[0]).toMatch(/tokens=\d+\(\d+\/\d+\)$/);
  });
});
