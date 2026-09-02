/**
 * Cancellation-signal tests — the engine's abort plumbing for the agent
 * loop: between-steps refusal, mid-shell kill, and the zero-change contract
 * when no signal is passed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPlan } from "../src/session.js";
import { executeStep, runShell } from "../src/executor.js";
import { readHistory } from "@tau/core";
import { registerCoreTools } from "@tau/tools";
import type { Plan } from "@tau/core";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-signal-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(path.join(tmp, "home"), { recursive: true });
  process.chdir(tmp);
  registerCoreTools();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const echoPlan = (text: string): Plan => ({
  explanation: "echo twice",
  steps: [
    { kind: "shell", command: `echo one-${text}`, reason: "first" },
    { kind: "shell", command: `echo two-${text}`, reason: "second" },
  ],
});

const baseOptions = { assumeYes: true, allowMediumAutoApprove: false, timeoutSec: 5 };

describe("runPlan with an AbortSignal", () => {
  it("is unaffected when the signal never aborts (zero-change contract)", async () => {
    const controller = new AbortController();
    const result = await runPlan("demo", echoPlan("fine"), {
      ...baseOptions,
      signal: controller.signal,
    });
    expect(result.status).toBe("ok");
    expect(result.outcomes.some((outcome) => outcome.cancelled)).toBe(false);
  });

  it("refuses steps after abort and ends cancelled with cancelled history", async () => {
    const controller = new AbortController();
    const result = await runPlan("demo", echoPlan("x"), {
      ...baseOptions,
      signal: controller.signal,
      onEvent: (event) => {
        // Abort the moment step 1 finishes — step 2 must never start.
        if (event.type === "step_end" && event.index === 0) controller.abort();
      },
    });
    expect(result.status).toBe("cancelled");
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0]?.ok).toBe(true); // step 1 ran
    expect(result.outcomes[1]?.cancelled).toBe(true); // step 2 refused
    expect(result.output).toBe("(cancelled by user)");
    const history = readHistory(3);
    expect(history[0]?.status).toBe("cancelled");
    expect(history[0]?.input).toBe("demo");
  });

  it("mid-shell abort kills the child and marks the outcome cancelled", async () => {
    const controller = new AbortController();
    const slowPlan: Plan = {
      explanation: "slow then fast",
      steps: [
        { kind: "shell", command: "sleep 5", reason: "slow" },
        { kind: "shell", command: "echo never", reason: "never" },
      ],
    };
    const started = Date.now();
    setTimeout(() => controller.abort(), 150);
    const result = await runPlan("cancel me", slowPlan, {
      ...baseOptions,
      timeoutSec: 30,
      signal: controller.signal,
    });
    const elapsed = Date.now() - started;
    expect(result.status).toBe("cancelled");
    expect(result.outcomes[0]?.cancelled).toBe(true);
    expect(result.output).toContain("(cancelled by user)");
    // Killed well before the 5s sleep would finish.
    expect(elapsed).toBeLessThan(2_000);
    const history = readHistory(3);
    expect(history[0]?.status).toBe("cancelled");
  });

  it("skips the whole plan when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runPlan("demo", echoPlan("late"), {
      ...baseOptions,
      signal: controller.signal,
    });
    expect(result.status).toBe("cancelled");
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.cancelled).toBe(true);
    expect(result.outcomes[0]?.skipped).toBe(true);
  });
});

describe("executor-level cancellation", () => {
  it("executeStep refuses a pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await executeStep({ kind: "shell", command: "echo hi", reason: "r" }, 0, {
      timeoutSec: 5,
      signal: controller.signal,
    });
    expect(outcome.cancelled).toBe(true);
    expect(outcome.skipped).toBe(true);
  });

  it("runShell aborts a running child and reports cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const outcome = await runShell("sleep 5 && echo done", {
      timeoutSec: 30,
      signal: controller.signal,
    });
    expect(outcome.cancelled).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toContain("(cancelled by user)");
  });
});
