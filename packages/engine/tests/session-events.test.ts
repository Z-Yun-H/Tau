import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPlan } from "../src/session.js";
import { registerCoreTools } from "@tau/tools";
import type { Plan, PlanEvent } from "@tau/core";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-events-"));
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

const shellPlan = (command: string): Plan => ({
  explanation: "run shell",
  steps: [{ kind: "shell", command, reason: "demo" }],
});

/** Collect events; returns them with a helper for compact type+index labels. */
function collect(): { events: PlanEvent[]; labels: () => string[] } {
  const events: PlanEvent[] = [];
  return {
    events,
    labels: () => events.map((e) => `${e.type}:${"index" in e ? e.index : "-"}`),
  };
}

describe("runPlan onEvent — execution paths", () => {
  it("streams step_start / step_output / step_end / plan_end on the ok path", async () => {
    const collector = collect();
    const result = await runPlan("echo demo", shellPlan("echo hello-events"), {
      assumeYes: false,
      allowMediumAutoApprove: false,
      timeoutSec: 10,
      autoApproveAll: true,
      skipHistory: true,
      onEvent: (e) => collector.events.push(e),
    });
    expect(result.status).toBe("ok");
    const labels = collector.labels();
    expect(labels).toEqual(["step_start:0", "step_output:0", "step_end:0", "plan_end:-"]);
    const output = collector.events.find((e) => e.type === "step_output");
    expect(output && "chunk" in output && output.chunk).toContain("hello-events");
    const end = collector.events.find((e) => e.type === "step_end");
    expect(end && "ok" in end && end.ok).toBe(true);
  });

  it("emits exactly one plan_end(denied) and no step events when review denies", async () => {
    const collector = collect();
    const result = await runPlan("nuke", shellPlan("rm -rf /"), {
      assumeYes: true,
      allowMediumAutoApprove: false,
      timeoutSec: 5,
      skipHistory: true,
      onEvent: (e) => collector.events.push(e),
    });
    expect(result.status).toBe("denied");
    expect(collector.labels()).toEqual(["plan_end:-"]);
  });

  it("marks gate-skipped steps via step_end(skipped) and terminates with failed", async () => {
    const collector = collect();
    // `rm <file>` matches a CAUTION pattern → high risk → assumeYes skips it
    const result = await runPlan("rm file", shellPlan("rm some-file.txt"), {
      assumeYes: true,
      allowMediumAutoApprove: false,
      timeoutSec: 5,
      skipHistory: true,
      onEvent: (e) => collector.events.push(e),
    });
    expect(result.status).toBe("failed");
    expect(result.outcomes[0]?.skipped).toBe(true);
    const labels = collector.labels();
    expect(labels).toEqual(["step_end:0", "plan_end:-"]);
    const end = collector.events[0] as Extract<PlanEvent, { type: "step_end" }>;
    expect(end.skipped).toBe(true);
    expect(end.ok).toBe(false);
  });

  it("stops after a failing step: no events beyond the failure", async () => {
    const collector = collect();
    const plan: Plan = {
      explanation: "two steps, second fails",
      steps: [
        { kind: "shell", command: "echo first", reason: "ok" },
        { kind: "shell", command: "exit 3", reason: "fails" },
        { kind: "shell", command: "echo never", reason: "never runs" },
      ],
    };
    const result = await runPlan("multi", plan, {
      assumeYes: false,
      allowMediumAutoApprove: false,
      timeoutSec: 10,
      autoApproveAll: true,
      skipHistory: true,
      onEvent: (e) => collector.events.push(e),
    });
    expect(result.status).toBe("failed");
    const labels = collector.labels();
    expect(labels).toEqual([
      "step_start:0",
      "step_output:0",
      "step_end:0",
      "step_start:1",
      "step_end:1",
      "plan_end:-",
    ]);
  });

  it("emits plan_end exactly once on the cancelled path", async () => {
    const collector = collect();
    // Non-interactive (no TTY in tests) + no assumeYes/autoApprove → cancelled.
    const result = await runPlan("nope", shellPlan("echo x"), {
      assumeYes: false,
      allowMediumAutoApprove: false,
      timeoutSec: 5,
      skipHistory: true,
      onEvent: (e) => collector.events.push(e),
    });
    expect(result.status).toBe("cancelled");
    expect(collector.labels()).toEqual(["plan_end:-"]);
  });

  it("emits nothing when no onEvent is provided (zero behavior change)", async () => {
    // Absence of the callback must not throw or alter the result shape.
    const result = await runPlan("echo demo", shellPlan("echo quiet"), {
      assumeYes: false,
      allowMediumAutoApprove: false,
      timeoutSec: 10,
      autoApproveAll: true,
      skipHistory: true,
    });
    expect(result.status).toBe("ok");
    expect(result.output).toContain("quiet");
  });
});
