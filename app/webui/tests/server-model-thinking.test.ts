/**
 * WebUI server tests — the model & thinking selection surface (issue #164):
 * GET /api/models (read-only catalog) plus POST /api/config/model and
 * POST /api/config/thinking (per-provider request knobs). The gate/risk
 * policy stays GET-only.
 *
 * Contract pinned here:
 * - GET /api/models serves the catalog service's shape (mock: a
 *   deterministic offline catalog); unknown providers → 400.
 * - Both writes validate BEFORE mutation (unknown provider / unknown
 *   fields / missing or malformed values → 400 and the config file stays
 *   untouched) and answer with the STANDARD REDACTED configPayload.
 * - Thinking writes refuse knobs the provider does not support — the
 *   same capability matrix the settings panel renders from.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configPath, loadConfig, tauHome } from "@tau/core";
import { startWebUi } from "../src/server.js";
import type { RunningWebUi } from "../src/server.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";
let ui: RunningWebUi;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-selection-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  ui = await startWebUi({ port: 0 });
});

afterEach(async () => {
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  delete process.env["TAU_WEBUI_QUIET"];
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const get = (pathName: string): Promise<{ status: number; json: any }> =>
  fetch(new URL(pathName, ui.url)).then(async (res) => ({
    status: res.status,
    json: await res.json(),
  }));

const post = (pathName: string, payload: unknown): Promise<{ status: number; json: any }> =>
  fetch(new URL(pathName, ui.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (res) => ({ status: res.status, json: await res.json() }));

const rawConfig = (): string | null =>
  fs.existsSync(configPath()) ? fs.readFileSync(configPath(), "utf8") : null;

describe("GET /api/models — catalog read", () => {
  it("serves the active provider's catalog shape (mock: offline deterministic)", async () => {
    const res = await get("/api/models");
    expect(res.status).toBe(200);
    expect(res.json.provider).toBe("mock");
    expect(["live", "cache"]).toContain(res.json.source);
    const ids = (res.json.models as { id: string }[]).map((m) => m.id);
    expect(ids).toContain("mock-chat");
    expect(ids).toContain("mock-reasoner");
  });

  it("accepts an explicit provider and refuses unknown ones", async () => {
    const named = await get("/api/models?provider=mock");
    expect(named.status).toBe(200);
    expect(named.json.provider).toBe("mock");

    const unknown = await get("/api/models?provider=nope");
    expect(unknown.status).toBe(400);
    expect(unknown.json.error).toContain("unknown provider");
  });
});

describe("POST /api/config/model — model choice", () => {
  it("persists the choice and answers with the redacted payload", async () => {
    const res = await post("/api/config/model", { provider: "mock", model: "mock-reasoner" });
    expect(res.status).toBe(200);
    expect(res.json.provider.name).toBe("mock");
    expect(res.json.config.providers["mock"]?.["model"]).toBe("mock-reasoner");
    expect(rawConfig()).toContain("mock-reasoner");
  });

  it("validates before mutation: unknown provider, missing model, unknown fields", async () => {
    const before = rawConfig();
    for (const [payload, message] of [
      [{ provider: "nope", model: "m" }, "unknown provider"],
      [{ provider: "mock" }, "model (string) is required"],
      [{ provider: "mock", model: "   " }, "model (string) is required"],
      [{ model: "m" }, "provider (string) is required"],
      [{ provider: "mock", model: "m", extra: 1 }, 'unknown field "extra"'],
    ] as [Record<string, unknown>, string][]) {
      const res = await post("/api/config/model", payload);
      expect(res.status).toBe(400);
      expect(res.json.error).toContain(message);
    }
    expect(rawConfig()).toBe(before);
  });
});

describe("POST /api/config/thinking — thinking knobs", () => {
  it("writes the normalized keys for a capable provider", async () => {
    const res = await post("/api/config/thinking", {
      provider: "anthropic",
      mode: "on",
      effort: "high",
    });
    expect(res.status).toBe(200);
    // The payload's thinking block describes the ACTIVE provider (mock
    // here) — the write targets the requested provider and lands on disk.
    expect(res.json.thinking.provider).toBe("mock");
    const entry = loadConfig().providers["anthropic"];
    expect(entry?.["thinking"]).toBe("on");
    expect(entry?.["thinkingEffort"]).toBe("high");
  });

  it("refuses knobs outside the provider's capability matrix", async () => {
    const mode = await post("/api/config/thinking", { provider: "mock", mode: "on" });
    expect(mode.status).toBe(400);
    expect(mode.json.error).toContain("does not support a thinking mode toggle");

    const effort = await post("/api/config/thinking", { provider: "openai", mode: "on" });
    expect(effort.status).toBe(400);
    expect(effort.json.error).toContain("does not support a thinking mode toggle");

    const effortOnModeless = await post("/api/config/thinking", {
      provider: "deepseek",
      effort: "high",
    });
    expect(effortOnModeless.status).toBe(400);
    expect(effortOnModeless.json.error).toContain("does not support a thinking effort level");
  });

  it("validates values before mutation and reports state in /api/config", async () => {
    const before = rawConfig();
    for (const [payload, message] of [
      [{ provider: "nope", mode: "on" }, "unknown provider"],
      [{ mode: "on" }, "provider (string) is required"],
      [{ provider: "anthropic", mode: "maybe" }, 'mode must be "on" or "off"'],
      [{ provider: "anthropic", effort: "extreme" }, 'effort must be "low", "medium" or "high"'],
      [{ provider: "anthropic" }, "nothing to set"],
      [{ provider: "anthropic", mode: "on", junk: 1 }, 'unknown field "junk"'],
    ] as [Record<string, unknown>, string][]) {
      const res = await post("/api/config/thinking", payload);
      expect(res.status).toBe(400);
      expect(res.json.error).toContain(message);
    }
    expect(rawConfig()).toBe(before);

    // The thinking block rides the ACTIVE provider's view: activate
    // anthropic (switching needs no key) and the panel reflects its state.
    await post("/api/config/thinking", { provider: "anthropic", mode: "on", effort: "low" });
    await post("/api/config/provider", { provider: "anthropic", activate: true });
    const config = await get("/api/config");
    expect(config.json.thinking.provider).toBe("anthropic");
    expect(config.json.thinking.summary).toBe("on (low)");
    expect(config.json.thinking.capability).toEqual({ mode: true, effort: true, budget: true });
  });
});
