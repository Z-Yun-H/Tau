/**
 * Streaming planning pipeline tests (v0.5.0) — planIntentStream /
 * planAndReviewStream and the runGoal per-round provider-stream relay,
 * driven by the offline mock provider plus a scripted no-planStream
 * provider for the fallback path. No network, no timers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tauHome, type AIProvider, type Plan, type PlanningContext } from "@tau/core";
import { registerProvider, registerProviderBuiltins, resetProviders } from "@tau/ai";
import { resetRegistry, registerCoreTools } from "@tau/tools";
import { planIntentStream, planIntent } from "../src/pipeline.js";
import { planAndReviewStream } from "../src/session.js";
import { runGoal, type RunGoalOptions } from "../src/loop.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-agent-stream-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  registerProviderBuiltins();
  registerCoreTools();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
  resetProviders();
  resetRegistry();
});

describe("planIntentStream", () => {
  it("relays mock reasoning → text → usage events and equals planIntent", async () => {
    const direct = await planIntent("find all ts files");
    const events: unknown[] = [];
    const streamed = await planIntentStream("find all ts files", {}, (e) => events.push(e));

    expect(streamed.plan).toEqual(direct.plan);
    expect(streamed.providerName).toBe("mock");
    expect(streamed.usage).toBeDefined();

    const kinds = events.map((e) => (e as { type: string }).type);
    expect(kinds[0]).toBe("reasoning_delta");
    expect(kinds).toContain("text_delta");
    expect(kinds.at(-1)).toBe("usage");
    const text = events
      .filter((e) => (e as { type: string }).type === "text_delta")
      .map((e) => (e as { text: string }).text)
      .join("");
    expect(JSON.parse(text)).toEqual(direct.plan);
  });

  it("falls back to buffered plan() for providers without planStream", async () => {
    const plan: Plan = {
      explanation: "buffered",
      steps: [{ kind: "shell", command: "echo hi", reason: "r" }],
      selfAssessedRisk: "low",
    };
    const buffered: AIProvider = {
      name: "buffered-only",
      label: "Buffered Only",
      isAvailable: async () => true,
      plan: async (_ctx: PlanningContext) => plan,
    };
    registerProvider(buffered);

    const events: unknown[] = [];
    const planned = await planIntentStream("anything", { provider: "buffered-only" }, (e) =>
      events.push(e),
    );
    expect(planned.plan).toEqual(plan);
    expect(events).toEqual([]); // fallback never invents events
  });

  it("planAndReviewStream attaches the deterministic review", async () => {
    const events: unknown[] = [];
    const planned = await planAndReviewStream("find all ts files", {}, (e) => events.push(e));
    expect(planned.review.verdict).toBe("allow");
    expect(planned.review.overallRisk).toBe("low");
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("runGoal onPlanStream relay", () => {
  const baseOptions = (overrides: Partial<RunGoalOptions> = {}): RunGoalOptions => ({
    assumeYes: true,
    allowMediumAutoApprove: false,
    timeoutSec: 5,
    skipHistory: true,
    autoApproveAll: true,
    ...overrides,
  });

  /** Scripted streaming provider: plan + reflect both stream, reflect done. */
  function registerScriptedStreamer(): void {
    const plan: Plan = {
      explanation: "scripted",
      steps: [{ kind: "shell", command: "echo GOAL_COMPLETE:done", reason: "r" }],
      selfAssessedRisk: "low",
    };
    const scripted: AIProvider = {
      name: "scripted-streamer",
      label: "Scripted Streamer",
      isAvailable: async () => true,
      plan: async () => plan,
      planStream: async (_ctx, onEvent) => {
        onEvent?.({ type: "reasoning_delta", text: "round-1 thinking" });
        onEvent?.({ type: "text_delta", text: JSON.stringify(plan) });
        return plan;
      },
      reflect: async () => ({ done: true, answer: "done" }),
      reflectStream: async (_ctx, onEvent) => {
        onEvent?.({ type: "reasoning_delta", text: "reflect thinking" });
        return { done: true, answer: "done" };
      },
    };
    registerProvider(scripted);
  }

  it("relays per-round planning events tagged with the round number", async () => {
    registerScriptedStreamer();
    const streamEvents: Array<{ round: number; type: string; text?: string }> = [];
    const goalEvents: unknown[] = [];
    const result = await runGoal("anything", {
      ...baseOptions({ provider: "scripted-streamer" }),
      onGoalEvent: (e) => goalEvents.push(e),
      onPlanStream: (event, round) => {
        const e = event as { type: string; text?: string };
        streamEvents.push({ round, type: e.type, ...(e.text ? { text: e.text } : {}) });
      },
    });
    expect(result.status).toBe("ok");
    expect(result.answer).toBe("done");

    // Round 1 streamed thinking + text; the reflect turn streamed thinking
    // under the NEXT round number (2).
    const rounds = streamEvents.map((e) => e.round);
    expect(rounds).toContain(1);
    expect(rounds).toContain(2);
    expect(streamEvents.some((e) => e.round === 1 && e.type === "reasoning_delta")).toBe(true);
    expect(streamEvents.some((e) => e.round === 2 && e.type === "reasoning_delta")).toBe(true);
    expect(goalEvents.some((e) => (e as { type: string }).type === "round_plan")).toBe(true);
  });

  it("absent onPlanStream keeps the buffered path (zero behavior change)", async () => {
    registerScriptedStreamer();
    const result = await runGoal("anything", baseOptions({ provider: "scripted-streamer" }));
    expect(result.status).toBe("ok");
    expect(result.rounds.length).toBe(1);
  });
});
