/**
 * /api/plan/stream — the streaming planning endpoint (v0.5.0, issue #110):
 * provider reasoning relays as NDJSON deltas, ONE terminal `plan` event
 * carries the SAME reviewed plan as POST /api/plan, providers without the
 * planStream capability still land a plan (buffered fallback), and every
 * refusal is plain JSON BEFORE any stream starts (400 missing intent,
 * 503 unavailable provider). The goal-stream thinking relay is covered by
 * the scripted planStream provider at the bottom of this file.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  tauHome,
  type Plan,
  type PlanningContext,
  type ProviderStreamEvent,
  type ProviderStreamHandler,
} from "@tau/core";
import { registerProvider, resetProviders, registerProviderBuiltins } from "@tau/ai";
import { ensureCatalog } from "@tau/agent";
import { startWebUi } from "../src/server.js";
import type { RunningWebUi } from "../src/server.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";
let ui: RunningWebUi;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-plan-stream-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
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
  delete process.env["TAU_WEBUI_QUIET"];
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
  resetProviders();
  registerProviderBuiltins();
});

const streamPost = async (
  payload: unknown,
): Promise<{
  status: number;
  contentType: string;
  body: string;
  lines: Record<string, unknown>[];
}> => {
  const res = await fetch(new URL("/api/plan/stream", ui.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  const lines = body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    body,
    lines,
  };
};

describe("POST /api/plan/stream", () => {
  it("validates the body as plain JSON before any stream starts", async () => {
    const missing = await streamPost({});
    expect(missing.status).toBe(400);
    expect(missing.contentType).toContain("application/json");
    expect(missing.lines).toEqual([{ error: "intent (string) is required" }]);
  });

  it("mock provider: reasoning deltas, then ONE terminal reviewed plan", async () => {
    const { status, contentType, lines } = await streamPost({
      intent: "find all *.ts files",
      provider: "mock",
    });
    expect(status).toBe(200);
    expect(contentType).toContain("application/x-ndjson");
    const types = lines.map((line) => line["type"]);
    expect(types[0]).toBe("reasoning_delta");
    expect(types).toContain("text_delta");
    expect(types.at(-1)).toBe("plan");

    // Assembled thinking is a real (deterministic) reasoning trace.
    const thinking = lines
      .filter((line) => line["type"] === "reasoning_delta")
      .map((line) => line["text"])
      .join("");
    expect(thinking.length).toBeGreaterThan(10);

    // The terminal event is the same reviewed contract POST /api/plan returns.
    const planEvent = lines.at(-1) as {
      intent: string;
      plan: Plan;
      review: { verdict: string; overallRisk: string };
      provider: string;
      providerLabel: string;
      warnings: string[];
    };
    expect(planEvent.intent).toBe("find all *.ts files");
    expect(Array.isArray(planEvent.plan.steps)).toBe(true);
    expect(planEvent.plan.steps.length).toBeGreaterThan(0);
    expect(planEvent.review.verdict).toBe("allow");
    expect(planEvent.provider).toBe("mock");
    expect(Array.isArray(planEvent.warnings)).toBe(true);
  });

  it("providers without planStream still land a plan (buffered, no deltas)", async () => {
    registerProvider({
      name: "buffered",
      label: "Buffered test provider",
      async isAvailable() {
        return true;
      },
      async plan(_ctx: PlanningContext): Promise<Plan> {
        return {
          explanation: "buffered plan",
          steps: [{ kind: "shell", command: "echo buffered", reason: "r" }],
        };
      },
    });
    const { lines } = await streamPost({ intent: "anything", provider: "buffered" });
    expect(lines.map((line) => line["type"])).toEqual(["plan"]);
    const planEvent = lines[0] as { plan: Plan; provider: string };
    expect(planEvent.plan.explanation).toBe("buffered plan");
    expect(planEvent.provider).toBe("buffered");
  });

  it("refuses an unavailable provider as plain JSON 503 — never a half-open stream", async () => {
    registerProvider({
      name: "downstream",
      label: "Unavailable test provider",
      isAvailable: async () => false,
      unavailableReason() {
        return "TAU_TEST_DOWN: not configured";
      },
      async plan(): Promise<Plan> {
        throw new Error("should never be reached");
      },
    });
    const { status, contentType, lines } = await streamPost({
      intent: "hello",
      provider: "downstream",
    });
    expect(status).toBe(503);
    expect(contentType).toContain("application/json");
    expect(lines[0]?.["error"]).toContain("TAU_TEST_DOWN");
  });

  it("goal stream relays round-tagged thinking deltas (scripted planStream provider)", async () => {
    const plan: Plan = {
      explanation: "scripted streaming plan",
      steps: [{ kind: "shell", command: "echo GOAL_COMPLETE: done", reason: "r" }],
    };
    registerProvider({
      name: "streamer",
      label: "Streaming test provider",
      async isAvailable() {
        return true;
      },
      async plan(): Promise<Plan> {
        return plan;
      },
      async planStream(_ctx: PlanningContext, onEvent?: ProviderStreamHandler): Promise<Plan> {
        onEvent?.({
          type: "reasoning_delta",
          text: "thinking about ",
        } satisfies ProviderStreamEvent);
        onEvent?.({ type: "reasoning_delta", text: "the goal" } satisfies ProviderStreamEvent);
        return plan;
      },
    });
    const res = await fetch(new URL("/api/goal/stream", ui.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "finish it", provider: "streamer" }),
    });
    const text = await res.text();
    const lines = text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(res.status).toBe(200);
    const thinking = lines.filter((line) => line["type"] === "round_thinking_delta");
    expect(thinking.length).toBe(2);
    expect(thinking.every((line) => line["round"] === 1)).toBe(true);
    const joined = thinking.map((line) => line["text"]).join("");
    expect(joined).toBe("thinking about the goal");
    // The round_plan still lands with the authoritative plan, and the goal completes.
    expect(lines.some((line) => line["type"] === "round_plan")).toBe(true);
    const result = lines.at(-1) as Record<string, unknown>;
    expect(result["type"]).toBe("goal_result");
    expect(result["status"]).toBe("ok");
  });
});

describe("POST /api/plan/stream — conversation history (issue #134)", () => {
  it("threads client history into the planning context", async () => {
    let captured: PlanningContext | undefined;
    registerProvider({
      name: "capture-ctx",
      label: "capture",
      isAvailable: async () => true,
      plan: async (ctx) => {
        captured = ctx;
        return { explanation: "ok", steps: [] } satisfies Plan;
      },
    });
    const res = await streamPost({
      intent: "now compress them",
      provider: "capture-ctx",
      history: [
        { role: "user", text: "find the big logs" },
        { role: "assistant", text: "found three logs" },
        { role: "nonsense", text: "dropped" },
      ],
    });
    expect(res.status).toBe(200);
    expect(captured?.intent).toContain("user: find the big logs");
    expect(captured?.intent).toContain("assistant: found three logs");
    expect(captured?.intent).toContain("Current request: now compress them");
    // malformed roles never reach the provider
    expect(captured?.intent).not.toContain("nonsense");
  });

  it("malformed history is dropped, not fatal", async () => {
    const res = await streamPost({
      intent: "find all *.ts files",
      provider: "mock",
      history: "garbage",
    });
    expect(res.status).toBe(200);
    expect(res.lines.some((line) => line["type"] === "plan")).toBe(true);
  });
});
