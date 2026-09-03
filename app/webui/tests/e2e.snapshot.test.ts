/**
 * WebUI end-to-end snapshots — the REAL server over REAL HTTP against a
 * TAU_HOME sandbox with the mock provider: status inventory, planning,
 * execution, and the NDJSON streaming endpoint. Responses are file-snapshotted
 * with dynamic fields normalized (sandbox paths, release version) so the
 * snapshots stay stable across machines and releases; anything the client
 * actually renders is snapshotted verbatim.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tauHome } from "@tau/core";
import { startWebUi } from "../src/server.js";
import type { RunningWebUi } from "../src/server.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";
let ui: RunningWebUi;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-e2e-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
  process.env.TAU_HOME = path.join(tmp, "home");
  // Silence the v0.4.0 request log for clean test output (unit 4 tests
  // assert the logger separately with an injected sink).
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  // Fixture tree the planned file.find can actually match.
  fs.writeFileSync(path.join(tmp, "readme.md"), "# demo\n");
  fs.mkdirSync(path.join(tmp, "docs"));
  fs.writeFileSync(path.join(tmp, "docs", "notes.md"), "- note\n");
  ui = await startWebUi({ port: 0 });
});

afterEach(async () => {
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  delete process.env["TAU_WEBUI_QUIET"];
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Normalize machine-specific values so file snapshots are portable. */
const normalize = (text: string): string =>
  text
    .replaceAll(tmp, "<sandbox>")
    .replaceAll(os.tmpdir(), "<tmpdir>")
    // The workspace version moves with releases — keep the snapshot stable.
    .replaceAll(/"version":"\d+\.\d+\.\d+"/g, '"version":"<version>"');

const get = async (pathname: string): Promise<string> =>
  normalize(await fetch(new URL(pathname, ui.url)).then((res) => res.text()));

const post = async (pathname: string, payload: unknown): Promise<string> =>
  normalize(
    await fetch(new URL(pathname, ui.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then((res) => res.text()),
  );

describe("WebUI e2e — real HTTP snapshots", () => {
  it("GET /api/status reports the runtime inventory", async () => {
    expect(await get("/api/status")).toMatchSnapshot();
  });

  it("GET /api/config snapshots the redacted settings surface", async () => {
    expect(await get("/api/config")).toMatchSnapshot();
  });

  it("POST /api/plan returns a reviewed mock plan", async () => {
    const body = await post("/api/plan", { intent: "find all *.md files" });
    const parsed = JSON.parse(body) as { plan: unknown };
    expect(parsed.plan).toBeTruthy();
    expect(body).toMatchSnapshot();
  });

  it("POST /api/execute runs the plan through the real engine", async () => {
    const planned = JSON.parse(await post("/api/plan", { intent: "find all *.md files" })) as {
      intent: string;
      plan: { steps: unknown[] };
    };
    const body = await post("/api/execute", {
      intent: planned.intent,
      plan: planned.plan,
    });
    expect(body).toContain('"ok":true');
    expect(body).toMatchSnapshot();
  });

  it("POST /api/execute/stream emits the full NDJSON lifecycle", async () => {
    const planned = JSON.parse(await post("/api/plan", { intent: "find all *.md files" })) as {
      intent: string;
      plan: { steps: unknown[] };
    };
    const res = await fetch(new URL("/api/execute/stream", ui.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: planned.intent, plan: planned.plan }),
    });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = normalize(await res.text())
      .trim()
      .split("\n");
    // One JSON object per line, ending with the terminal result event.
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(lines.at(-1)).toContain('"type":"result"');
    expect(lines.join("\n")).toMatchSnapshot();
  });

  it("POST /api/plan/stream snapshots the streaming planning lifecycle", async () => {
    // The mock provider's planStream is deterministic: canned reasoning
    // chunks, the plan JSON in text deltas, then usage, then ONE terminal
    // reviewed plan event — this snapshot pins that client-visible contract.
    const res = await fetch(new URL("/api/plan/stream", ui.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "find all *.md files" }),
    });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const text = normalize(await res.text());
    const lines = text.trim().split("\n");
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    const types = lines.map((line) => (JSON.parse(line) as { type: string }).type);
    expect(types[0]).toBe("reasoning_delta");
    expect(types).toContain("text_delta");
    expect(types).toContain("usage");
    expect(types.at(-1)).toBe("plan");
    expect(text).toMatchSnapshot();
  });

  it("POST /api/goal/stream snapshots round thinking relay to goal_result", async () => {
    // Fallback echo intent → one round whose planning streams
    // round_thinking_delta/round_text_delta, then the executed round, then
    // reflection sees the GOAL_COMPLETE marker and the goal ends done.
    const res = await fetch(new URL("/api/goal/stream", ui.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "echo GOAL_COMPLETE:workspace scanned" }),
    });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const text = normalize(await res.text()).replaceAll(/"goalId":"[^"]*"/g, '"goalId":"<goalId>"');
    const lines = text.trim().split("\n");
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(lines.some((line) => line.includes('"type":"round_thinking_delta"'))).toBe(true);
    expect(lines.at(-1)).toContain('"type":"goal_result"');
    expect(lines.at(-1)).toContain('"status":"ok"');
    expect(text).toMatchSnapshot();
  });
});
