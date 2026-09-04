/**
 * WebUI server tests — HTTP surface over the real engine: status, static
 * assets, mock-provider planning, and the execution gate (deny verdicts are
 * refused before anything runs).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configPath, loadConfig, maskSecret, redactConfig, tauHome } from "@tau/core";
import { startWebUi } from "../src/server.js";
import type { RunningWebUi } from "../src/server.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";
let ui: RunningWebUi;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
  process.env.TAU_HOME = path.join(tmp, "home");
  // Silence the v0.4.0 request log for clean test output (unit 4 tests
  // assert the logger separately with an injected sink).
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

const get = (pathName: string): Promise<{ status: number; body: string }> =>
  fetch(new URL(pathName, ui.url)).then(async (res) => ({
    status: res.status,
    body: await res.text(),
  }));

const post = (pathName: string, payload: unknown): Promise<{ status: number; json: any }> =>
  fetch(new URL(pathName, ui.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (res) => ({ status: res.status, json: await res.json() }));

describe("static assets", () => {
  it("serves the index page", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.body).toContain("tau web");
  });

  it("404s unknown paths", async () => {
    expect((await get("/nope.js")).status).toBe(404);
  });

  it("blocks path traversal outside public/", async () => {
    expect((await get("/../../package.json")).status).toBe(404);
  });
});

describe("GET API", () => {
  it("reports status with provider and skill counts", async () => {
    const res = await get("/api/status");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.version).toBeTruthy();
    expect(body.provider.name).toBe("mock");
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.skills).toBeGreaterThan(0); // bundled skills ship with @tau/skills
    expect(body.tauHome).toBe(tauHome());
  });

  it("lists bundled skills", async () => {
    const body = JSON.parse((await get("/api/skills")).body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((skill: { name: string }) => skill.name === "git-helper")).toBe(true);
  });

  it("serves the webui slash-command catalog as pure metadata", async () => {
    const res = await get("/api/commands");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { commands: Array<{ name: string; description: string }> };
    expect(Array.isArray(body.commands)).toBe(true);
    const names = body.commands.map((command) => command.name);
    // webui surface: shared commands + webui-only commands
    for (const name of [
      "help",
      "skills",
      "history",
      "status",
      "new",
      "theme",
      "plan",
      "agent",
      "tools",
      "settings",
    ]) {
      expect(names, name).toContain(name);
    }
    // tui-only commands must not leak
    expect(names).not.toContain("provider");
    expect(names).not.toContain("md");
    expect(names).not.toContain("view");
    // pure metadata: descriptions always present, no executable surface
    for (const command of body.commands) {
      expect(command.description.length).toBeGreaterThan(0);
      expect(JSON.stringify(command)).not.toContain("run(");
    }
  });

  it("lists the tool layer as pure data (no executables)", async () => {
    const res = await get("/api/tools");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    const names = body.map((tool: { name: string }) => tool.name);
    expect(names).toContain("file.find");
    expect(names).toContain("file.rename");
    const find = body.find((tool: { name: string }) => tool.name === "file.find");
    expect(find.risk).toBe("low");
    expect(
      find.params.some(
        (p: { name: string; required: boolean }) => p.name === "pattern" && p.required,
      ),
    ).toBe(true);
    // The serialized inventory is data, never the registry's run functions.
    expect(res.body).not.toContain('"run"');
  });

  it("returns history (possibly empty)", async () => {
    const body = JSON.parse((await get("/api/history")).body);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("plan + execute gate", () => {
  it("plans with the mock provider", async () => {
    const { status, json } = await post("/api/plan", { intent: "find *.ts files" });
    expect(status).toBe(200);
    expect(json.provider).toBe("mock");
    expect(json.plan.steps[0]?.tool).toBe("file.find");
    expect(json.review.verdict).toBeDefined();
  });

  it("rejects plans without intent", async () => {
    expect((await post("/api/plan", {})).status).toBe(400);
  });

  it("refuses denied plans before execution", async () => {
    const { status, json } = await post("/api/execute", {
      intent: "nuke everything",
      plan: { explanation: "wipe", steps: [{ kind: "shell", command: "rm -rf /" }] },
    });
    expect(status).toBe(403);
    expect(json.review.verdict).toBe("deny");
  });

  it("executes a benign low-risk tool plan", async () => {
    const { status, json } = await post("/api/execute", {
      intent: "show system info",
      plan: {
        explanation: "system info",
        steps: [{ kind: "tool", tool: "sys.info", args: {}, reason: "test" }],
        selfAssessedRisk: "low",
      },
    });
    expect(status).toBe(200);
    expect(json.status).toBe("ok");
    expect(json.outcomes[0]?.ok).toBe(true);
  });

  it("404s unknown API routes", async () => {
    expect((await post("/api/nope", {})).status).toBe(404);
  });
});

describe("GET /api/config", () => {
  it("returns the redacted effective config — never a plaintext key", async () => {
    // A realistic secret in the sandbox config must never leave the server.
    fs.mkdirSync(tauHome(), { recursive: true });
    fs.writeFileSync(
      configPath(),
      JSON.stringify({
        provider: "mock",
        providers: { openai: { apiKey: "sk-super-secret-1234", model: "gpt-x" } },
      }),
    );
    const res = await get("/api/config");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    // Field-consistency contract: the same redaction the CLI prints.
    expect(body.config).toEqual(redactConfig(loadConfig()));
    expect(body.config.providers.openai.apiKey).toBe(maskSecret("sk-super-secret-1234"));
    // The plaintext must not appear anywhere in the response body.
    expect(res.body).not.toContain("sk-super-secret-1234");
  });

  it("exposes provider, availability, and model-catalog cache state", async () => {
    const res = await get("/api/config");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.provider.name).toBe("mock");
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers.some((p: { name: string }) => p.name === "mock")).toBe(true);
    expect(typeof body.modelCatalog.count).toBe("number");
    expect(body.tauHome).toBe(tauHome());
  });

  it("is a read-only surface — other methods 404", async () => {
    expect((await post("/api/config", { provider: "mock" })).status).toBe(404);
  });
});
