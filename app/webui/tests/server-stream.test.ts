/**
 * /api/execute/stream — the NDJSON streaming endpoint over the REAL engine:
 * event sequence, authoritative final result, and the identical deterministic
 * gates (deny verdicts are refused as plain JSON — never a stream).
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

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-stream-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  // tool steps resolve relative to cwd — run against the sandbox dir
  process.chdir(tmp);
  // tool-step plans resolve through the registry — ensureCatalog() is the
  // same reset+register path the production endpoints use
  ensureCatalog();
  ui = await startWebUi({ port: 0 });
});

afterEach(async () => {
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const streamPost = async (
  payload: unknown,
): Promise<{ status: number; contentType: string; lines: Record<string, unknown>[] }> => {
  const res = await fetch(new URL("/api/execute/stream", ui.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const lines = text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", lines };
};

const findPlan = (): unknown => ({
  explanation: "find txt files",
  steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.txt" }, reason: "lookup" }],
});

describe("POST /api/execute/stream", () => {
  it("streams lifecycle events then an authoritative result", async () => {
    fs.writeFileSync(path.join(tmp, "a.txt"), "x");
    const { status, contentType, lines } = await streamPost({
      intent: "find txt",
      plan: findPlan(),
    });
    expect(status).toBe(200);
    expect(contentType).toContain("application/x-ndjson");
    const types = lines.map((l) => l["type"]);
    expect(types[0]).toBe("step_start");
    expect(types).toContain("step_end");
    expect(types.at(-1)).toBe("result");
    const result = lines.at(-1) as { status: string; output: string; outcomes: unknown[] };
    expect(result.status).toBe("ok");
    expect(result.output).toContain("a.txt");
    expect(result.outcomes).toHaveLength(1);
  });

  it("streams shell output chunks live (step_output events)", async () => {
    const { lines } = await streamPost({
      intent: "echo demo",
      plan: {
        explanation: "echo",
        steps: [{ kind: "shell", command: "echo stream-live", reason: "demo" }],
      },
    });
    const outputs = lines.filter((l) => l["type"] === "step_output");
    const joined = outputs.map((l) => l["chunk"]).join("");
    expect(joined).toContain("stream-live");
    const result = lines.at(-1) as { status: string };
    expect(result.status).toBe("ok");
  });

  it("refuses deny-verdict plans as plain JSON, not a stream", async () => {
    const { status, contentType, lines } = await streamPost({
      intent: "nuke",
      plan: {
        explanation: "rm",
        steps: [{ kind: "shell", command: "rm -rf /", reason: "nope" }],
      },
    });
    expect(status).toBe(403);
    expect(contentType).toContain("application/json");
    expect(lines[0]?.["error"]).toContain("denied");
  });

  it("refuses high-risk plans without confirmHighRisk (gate parity)", async () => {
    const { status, lines } = await streamPost({
      intent: "rm file",
      plan: {
        explanation: "rm",
        steps: [{ kind: "shell", command: "rm some-file.txt", reason: "nope" }],
      },
    });
    expect(status).toBe(403);
    expect(lines[0]?.["error"]).toContain("confirmHighRisk");
  });

  it("stops at a failing step: failed status, honest outcome", async () => {
    const { lines } = await streamPost({
      intent: "two steps, second fails",
      plan: {
        explanation: "two steps",
        steps: [
          { kind: "shell", command: "echo first", reason: "ok" },
          { kind: "shell", command: "exit 3", reason: "fails" },
          { kind: "shell", command: "echo never", reason: "never runs" },
        ],
      },
    });
    const result = lines.at(-1) as { status: string; outcomes: { ok: boolean }[] };
    expect(result.status).toBe("failed");
    expect(result.outcomes).toHaveLength(2); // third step never ran
    expect(result.outcomes[1]?.ok).toBe(false);
  });
});
