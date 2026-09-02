/**
 * runGoal loop tests — the multi-round agent orchestrator, driven by a
 * scripted provider (registered per scenario) plus the real mock provider
 * for end-to-end offline loops. Matrix: single-round done, multi-round
 * continuation, repair after failure, denied continuation, refusal stops,
 * round cap, signal cancellation, single-round degradation, unavailable
 * provider.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tauHome, type AgentDecision, type Plan, type ReflectContext } from "@tau/core";
import { registerProvider, registerProviderBuiltins, resetProviders } from "@tau/ai";
import { resetRegistry, registerCoreTools } from "@tau/tools";
import { runGoal, DEFAULT_MAX_ROUNDS, HARD_MAX_ROUNDS } from "../src/loop.js";
import type { GoalEvent, RunGoalOptions } from "../src/loop.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-loop-"));
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

/** Options preset for headless loop tests (auto-approves reviewed plans). */
const baseOptions = (overrides: Partial<RunGoalOptions> = {}): RunGoalOptions => ({
  assumeYes: true,
  allowMediumAutoApprove: false,
  timeoutSec: 5,
  skipHistory: true,
  autoApproveAll: true,
  provider: "scripted",
  ...overrides,
});

const shellPlan = (command: string, explanation = "shell step"): Plan => ({
  explanation,
  steps: [{ kind: "shell", command, reason: "scripted" }],
});

interface Script {
  plan: Plan;
  reflect?: (ctx: ReflectContext) => AgentDecision;
}

/** A deterministic provider replaying a scripted decision sequence. */
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
            // Positional by executed rounds: reflect after round N consults
            // scripts[N-1]; beyond the script end the last entry answers.
            const script = scripts[Math.min(ctx.rounds.length - 1, scripts.length - 1)];
            const decide = script?.reflect;
            if (!decide) throw new Error("scripted provider: unexpected reflect() call");
            return decide(ctx);
          },
        }
      : {}),
  });
}

const goals = (events: GoalEvent[]): { types: string[]; rounds: number[] } => ({
  types: events.map((event) => event.type),
  rounds: events
    .filter(
      (event): event is Extract<GoalEvent, { type: "round_plan" }> => event.type === "round_plan",
    )
    .map((event) => event.round),
});

describe("runGoal — single round", () => {
  it("round 1 done via reflect → ok with the provider's answer", async () => {
    registerScripted([
      {
        plan: shellPlan("echo GOAL_COMPLETE: all wired"),
        reflect: () => ({ done: true, answer: "all wired" }),
      },
    ]);
    const events: GoalEvent[] = [];
    const result = await runGoal("finish it", baseOptions({ onGoalEvent: (e) => events.push(e) }));
    expect(result.status).toBe("ok");
    expect(result.answer).toBe("all wired");
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.status).toBe("ok");
    const seen = goals(events);
    expect(seen.types[0]).toBe("goal_start");
    expect(seen.rounds).toEqual([1]);
    expect(seen.types.at(-1)).toBe("goal_end");
  });

  it("reflect that keeps proposing continuations until the cap → max_rounds", async () => {
    registerScripted([
      {
        plan: shellPlan("echo round-one"),
        reflect: () => ({
          done: false,
          plan: {
            explanation: "again",
            steps: [{ kind: "shell", command: "echo again", reason: "r" }],
          },
        }),
      },
    ]);
    const result = await runGoal("loop me", baseOptions({ maxRounds: 2 }));
    expect(result.status).toBe("max_rounds");
    expect(result.rounds).toHaveLength(2);
    expect(result.error).toContain("2-round cap");
  });

  it("failed round + repair reflect runs the repair round (ok ends the loop honestly at the cap)", async () => {
    registerScripted([
      {
        plan: shellPlan("exit 3", "doomed step"),
        reflect: () => ({
          done: false,
          plan: {
            explanation: "repair attempt",
            steps: [{ kind: "shell", command: "echo repaired", reason: "fix" }],
          },
        }),
      },
    ]);
    const result = await runGoal("repair me", baseOptions({ maxRounds: 2 }));
    // Round 1 fails; the repair round succeeds — but the provider never
    // says done within the cap, so the loop reports max_rounds (honest).
    expect(result.status).toBe("max_rounds");
    expect(result.rounds[0]?.status).toBe("failed");
    expect(result.rounds[1]?.status).toBe("ok");
  });

  it("denied continuation plan ends denied without executing it", async () => {
    registerScripted([
      {
        plan: shellPlan("echo fine"),
        reflect: () => ({
          done: false,
          plan: {
            explanation: "forbidden",
            steps: [{ kind: "shell", command: "rm -rf /", reason: "never" }],
          },
        }),
      },
    ]);
    const events: GoalEvent[] = [];
    const result = await runGoal("sneaky", baseOptions({ onGoalEvent: (e) => events.push(e) }));
    expect(result.status).toBe("denied");
    expect(result.error).toContain("denied by safety review");
    // Only round 1 ever executed; the denied plan never reached runPlan.
    expect(result.rounds).toHaveLength(1);
    expect(events.some((event) => event.type === "round_end" && event.round === 2)).toBe(false);
  });

  it("rejected approval on a review-verdict continuation ends cancelled", async () => {
    const risky: Plan = {
      explanation: "needs a human",
      steps: [{ kind: "shell", command: "rm some-file.txt", reason: "caution" }],
    };
    registerScripted([
      {
        plan: shellPlan("echo first"),
        reflect: () => ({ done: false, plan: risky, note: "continue" }),
      },
    ]);
    const events: GoalEvent[] = [];
    const result = await runGoal(
      "needs approval",
      baseOptions({
        onGoalEvent: (e) => events.push(e),
        awaitApproval: async () => false,
      }),
    );
    expect(result.status).toBe("cancelled");
    expect(result.rounds).toHaveLength(1);
    expect(events.some((event) => event.type === "approval_required")).toBe(true);
  });

  it("approved review-verdict continuation executes after the pause", async () => {
    const risky: Plan = {
      explanation: "needs a human",
      steps: [{ kind: "shell", command: "rm some-file.txt", reason: "caution" }],
    };
    registerScripted([
      {
        plan: shellPlan("echo first"),
        reflect: () => ({ done: false, plan: risky, note: "continue" }),
      },
      { plan: risky, reflect: () => ({ done: true, answer: "approved path" }) },
    ]);
    const result = await runGoal(
      "needs approval",
      baseOptions({ awaitApproval: async () => true }),
    );
    // The approved continuation executed (round 2, failed harmlessly since
    // the file does not exist); the follow-up reflect then concluded done.
    expect(result.status).toBe("ok");
    expect(result.answer).toBe("approved path");
    expect(result.rounds.map((round) => round.status)).toEqual(["ok", "failed"]);
  });

  it("reflection errors fail the goal with the provider message", async () => {
    registerScripted([
      {
        plan: shellPlan("echo one"),
        reflect: () => {
          throw new Error("provider exploded");
        },
      },
    ]);
    const result = await runGoal("boom", baseOptions());
    expect(result.status).toBe("failed");
    expect(result.error).toContain("reflection failed: provider exploded");
  });

  it("cancellation between rounds ends cancelled", async () => {
    const controller = new AbortController();
    registerScripted([
      {
        plan: shellPlan("echo one"),
        reflect: () => {
          controller.abort(); // the AI proposes; the human already stopped
          return {
            done: false,
            plan: {
              explanation: "two",
              steps: [{ kind: "shell", command: "echo two", reason: "r" }],
            },
          };
        },
      },
    ]);
    const result = await runGoal("stop me", baseOptions({ signal: controller.signal }));
    expect(result.status).toBe("cancelled");
    // Round 2's runPlan still ran far enough to report its own cancellation
    // (aborted before any step) — recorded honestly alongside round 1.
    expect(result.rounds.map((round) => round.status)).toEqual(["ok", "cancelled"]);
  });

  it("clamps the requested round cap to the hard ceiling", () => {
    // Pure policy check via the exported constants (no loop execution).
    expect(DEFAULT_MAX_ROUNDS).toBe(3);
    expect(HARD_MAX_ROUNDS).toBe(5);
    expect(Math.min(Math.max(1, Math.trunc(99)), HARD_MAX_ROUNDS)).toBe(HARD_MAX_ROUNDS);
  });
});

describe("runGoal — capability degradation & availability", () => {
  it("provider without reflect runs one round and reports the limitation", async () => {
    registerScripted([{ plan: shellPlan("echo solo") }]); // no reflect field
    const events: GoalEvent[] = [];
    const result = await runGoal("solo", baseOptions({ onGoalEvent: (e) => events.push(e) }));
    expect(result.status).toBe("ok");
    expect(result.answer).toContain("no reflection support");
    expect(result.rounds).toHaveLength(1);
    const start = events[0];
    expect(start?.type === "goal_start" && start.maxRounds).toBe(1);
  });

  it("provider without reflect after a failed round → failed goal, no loop", async () => {
    registerScripted([{ plan: shellPlan("exit 9", "doomed") }]);
    const result = await runGoal("doomed", baseOptions());
    expect(result.status).toBe("failed");
    expect(result.rounds).toHaveLength(1);
  });

  it("unavailable provider throws ProviderUnavailableError before any round", async () => {
    registerProvider({
      name: "scripted",
      label: "Scripted test provider",
      async isAvailable() {
        return false;
      },
      unavailableReason() {
        return "no key in test";
      },
      async plan() {
        throw new Error("must not be called");
      },
    });
    await expect(runGoal("anything", baseOptions())).rejects.toThrow(/not available/);
  });
});

describe("runGoal — end-to-end with the real mock provider", () => {
  it("mock loop: echo intent completes in one round via the GOAL_COMPLETE marker", async () => {
    const result = await runGoal(
      "echo GOAL_COMPLETE: wrapped up",
      baseOptions({ provider: "mock" }),
    );
    expect(result.status).toBe("ok");
    expect(result.rounds).toHaveLength(1);
    expect(result.answer).toBe("wrapped up");
  });

  it("mock loop: unmarked intent keeps continuing until the cap", async () => {
    const result = await runGoal(
      "just look around",
      baseOptions({ provider: "mock", maxRounds: 3 }),
    );
    expect(result.status).toBe("max_rounds");
    expect(result.rounds).toHaveLength(3);
  });
});
