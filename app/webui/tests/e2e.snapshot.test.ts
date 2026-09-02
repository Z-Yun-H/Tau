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
  process.env.TAU_HOME = path.join(tmp, "home");
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
});
