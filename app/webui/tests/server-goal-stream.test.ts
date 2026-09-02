/**
 * /api/goal/stream + /api/goal/approve — the agent-mode streaming endpoints
 * over the REAL engine and runGoal: event lifecycle, approval pause/resume,
 * refusal paths, TTL expiry, unknown-goal 404, and the input validation
 * contract (plain-JSON refusals, never a broken stream).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tauHome, type AgentDecision, type Plan, type ReflectContext } from "@tau/core";
import { registerProvider, resetProviders, registerProviderBuiltins } from "@tau/ai";
import { ensureCatalog } from "@tau/agent";
import { startWebUi } from "../src/server.js";
import { approvalTtlMs } from "../src/goal.js";
import type { RunningWebUi } from "../src/server.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";
let ui: RunningWebUi;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-goal-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  registerProviderBuiltins();
  ensureCatalog();
  ui = await startWebUi({ port: 0 });
});

afterEach(async () => {
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  delete process.env["TAU_WEBUI_APPROVAL_TTL_MS"];
  fs.rmSync(tmp, { recursive: true, force: true });
  resetProviders();
  registerProviderBuiltins();
});

interface Script {
  plan: Plan;
  reflect?: (ctx: ReflectContext) => AgentDecision;
}

/** Register a deterministic provider for server-side goal scenarios. */
function registerScripted(scripts: Script[]): void {
  let planCall = 0;
  registerProvider({
    name: "scripted",
    label: "Scripted test provider",
    async isAvailable() {
      return true;
    },
    async plan() {
      const script = scripts[planCall];
      planCall += 1;
      if (!script) throw new Error("scripted provider: unexpected extra plan() call");
      return script.plan;
    },
    ...(scripts.some((script) => script.reflect !== undefined)
      ? {
          async reflect(ctx: ReflectContext): Promise<AgentDecision> {
            const script = scripts[Math.min(ctx.rounds.length - 1, scripts.length - 1)];
            const decide = script?.reflect;
            if (!decide) throw new Error("scripted provider: unexpected reflect() call");
            return decide(ctx);
          },
        }
      : {}),
  });
}

const streamGoal = async (
  payload: unknown,
): Promise<{ status: number; lines: Record<string, unknown>[] }> => {
  const res = await fetch(new URL("/api/goal/stream", ui.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const lines = text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { status: res.status, lines };
};

const shellPlan = (command: string, explanation = "shell step"): Plan => ({
  explanation,
  steps: [{ kind: "shell", command, reason: "scripted" }],
});

describe("POST /api/goal/stream", () => {
  it("validates the body as plain JSON before any stream starts", async () => {
    const missing = await streamGoal({});
    expect(missing.status).toBe(400);
    expect(missing.lines[0]).toEqual({ error: "intent (string) is required" });
  });

  it("mock single-round goal: full NDJSON lifecycle ends with a done answer", async () => {
    const { status, lines } = await streamGoal({
      intent: "echo GOAL_COMPLETE: wrapped",
      provider: "mock",
    });
    expect(status).toBe(200);
    const types = lines.map((line) => line["type"]);
    expect(types[0]).toBe("goal_registered");
    expect(types).toContain("goal_start");
    expect(types).toContain("round_plan");
    expect(types).toContain("step_start"); // existing event shapes mirrored
    expect(types).toContain("round_end");
    expect(types.at(-2)).toBe("goal_end");
    expect(types.at(-1)).toBe("goal_result");
    const result = lines.at(-1) as Record<string, unknown>;
    expect(result["status"]).toBe("ok");
    expect(result["answer"]).toBe("wrapped");
    expect(result["rounds"]).toBe(1);
    // goal_registered carries the id used by /api/goal/approve.
    expect(typeof lines[0]?.["goalId"]).toBe("string");
  });

  it("multi-round scripted goal keeps proposing until the round cap", async () => {
    registerScripted([
      {
        plan: shellPlan("echo one"),
        reflect: () => ({
          done: false,
          plan: {
            explanation: "again",
            steps: [{ kind: "shell", command: "echo again", reason: "r" }],
          },
        }),
      },
    ]);
    const { lines } = await streamGoal({
      intent: "loop",
      provider: "scripted",
      maxRounds: 2,
    });
    const result = lines.at(-1) as Record<string, unknown>;
    expect(result["status"]).toBe("max_rounds");
    expect(result["rounds"]).toBe(2);
    const roundNumbers = lines
      .filter((line) => line["type"] === "round_plan")
      .map((line) => line["round"]);
    expect(roundNumbers).toEqual([1, 2]);
  });

  it("approval resume: POST /api/goal/approve unblocks the paused round", async () => {
    registerScripted([
      {
        plan: {
          explanation: "rename with consent",
          steps: [
            { kind: "tool", tool: "file.rename", args: { find: "a", replace: "b" }, reason: "r" },
          ],
        },
        reflect: () => ({ done: true, answer: "approved path" }),
      },
    ]);
    // Shorten the TTL so a stuck stream can never wedge the suite.
    process.env["TAU_WEBUI_APPROVAL_TTL_MS"] = "5000";
    // Read the stream incrementally: when approval_required arrives, decide
    // from this side via /api/goal/approve and let the loop resume.
    const res = await fetch(new URL("/api/goal/stream", ui.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "medium", provider: "scripted" }),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const lines: Record<string, unknown>[] = [];
    let approved = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number | undefined;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const event = JSON.parse(line) as Record<string, unknown>;
        lines.push(event);
        if (event["type"] === "approval_required" && !approved) {
          approved = true;
          const goalId = lines[0]?.["goalId"] as string;
          const approveRes = await fetch(new URL("/api/goal/approve", ui.url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ goalId, approve: true }),
          });
          expect(approveRes.status).toBe(200);
        }
      }
    }
    const result = lines.at(-1) as Record<string, unknown>;
    expect(approved).toBe(true);
    expect(result["type"]).toBe("goal_result");
    expect(result["status"]).toBe("ok");
    expect(result["answer"]).toBe("approved path");
  });

  it("approve with an unknown goal id is a 404", async () => {
    const res = await fetch(new URL("/api/goal/approve", ui.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goalId: "g-nope", approve: true }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("unknown or expired goal");
  });

  it("approve without goalId is a 400", async () => {
    const res = await fetch(new URL("/api/goal/approve", ui.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approve: true }),
    });
    expect(res.status).toBe(400);
  });

  it("approval TTL expiry ends the goal cancelled and streams approval_timeout", async () => {
    process.env["TAU_WEBUI_APPROVAL_TTL_MS"] = "250";
    registerScripted([
      {
        plan: {
          explanation: "needs a human",
          steps: [
            { kind: "tool", tool: "file.rename", args: { find: "a", replace: "b" }, reason: "r" },
          ],
        },
        reflect: () => ({ done: true, answer: "never" }),
      },
    ]);
    const { lines } = await streamGoal({ intent: "slow human", provider: "scripted" });
    const types = lines.map((line) => line["type"]);
    expect(types).toContain("approval_timeout");
    const result = lines.at(-1) as Record<string, unknown>;
    expect(result["status"]).toBe("cancelled");
  });

  it("denied continuation never executes and ends denied", async () => {
    registerScripted([
      {
        plan: shellPlan("echo fine"),
        reflect: () => ({
          done: false,
          plan: {
            explanation: "nope",
            steps: [{ kind: "shell", command: "rm -rf /", reason: "r" }],
          },
        }),
      },
    ]);
    const { lines } = await streamGoal({ intent: "sneaky", provider: "scripted" });
    const result = lines.at(-1) as Record<string, unknown>;
    expect(result["status"]).toBe("denied");
    expect(result["rounds"]).toBe(1);
  });

  it("client disconnect aborts the goal (signal path)", async () => {
    registerScripted([
      {
        plan: shellPlan("sleep 5", "slow"),
        reflect: () => ({ done: true, answer: "unreachable" }),
      },
    ]);
    const controller = new AbortController();
    const resPromise = fetch(new URL("/api/goal/stream", ui.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "disconnect", provider: "scripted" }),
      signal: controller.signal,
    });
    const res = await resPromise;
    // Consume a little, then disconnect while the shell runs.
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    // The server must settle without hanging: give it a moment; any
    // unhandled rejection would fail the suite. Server stays usable:
    const status = await fetch(new URL("/api/status", ui.url));
    expect(status.status).toBe(200);
  });
});

describe("approvalTtlMs", () => {
  it("defaults to 10 minutes and honours a numeric env override", () => {
    expect(approvalTtlMs({})).toBe(10 * 60_000);
    expect(approvalTtlMs({ TAU_WEBUI_APPROVAL_TTL_MS: "500" })).toBe(500);
    expect(approvalTtlMs({ TAU_WEBUI_APPROVAL_TTL_MS: "nope" })).toBe(10 * 60_000);
    expect(approvalTtlMs({ TAU_WEBUI_APPROVAL_TTL_MS: "-3" })).toBe(10 * 60_000);
  });
});
