import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPlan } from "../src/session.js";
import { registerCoreTools, registerTools, getTool } from "@tau/tools";
import { readHistory } from "@tau/core";
import type { Plan, ToolDefinition } from "@tau/core";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-session-"));
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

const findPlan = (): Plan => ({
  explanation: "find txt files",
  steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.txt" }, reason: "lookup" }],
});

const shellPlan = (command: string): Plan => ({
  explanation: "run shell",
  steps: [{ kind: "shell", command, reason: "demo" }],
});

describe("runPlan", () => {
  it("executes a low-risk tool plan end-to-end and writes history", async () => {
    fs.writeFileSync("a.txt", "x");
    const result = await runPlan("find txt", findPlan(), {
      assumeYes: false,
      allowMediumAutoApprove: false,
      timeoutSec: 5,
      autoApproveAll: true,
    });
    expect(result.status).toBe("ok");
    expect(result.output).toContain("a.txt");
    const history = readHistory(5);
    expect(history[0]?.status).toBe("ok");
    expect(history[0]?.input).toBe("find txt");
  });

  it("denies deny-listed shell plans without executing and records denial", async () => {
    const result = await runPlan("bad idea", shellPlan("rm -rf /"), {
      assumeYes: true,
      allowMediumAutoApprove: false,
      timeoutSec: 5,
    });
    expect(result.status).toBe("denied");
    expect(result.outcomes).toHaveLength(0);
    expect(readHistory(5)[0]?.status).toBe("denied");
  });

  it("can skip history (tests)", async () => {
    await runPlan("no history please", findPlan(), {
      assumeYes: false,
      allowMediumAutoApprove: false,
      timeoutSec: 5,
      autoApproveAll: true,
      skipHistory: true,
    });
    expect(readHistory(5)).toHaveLength(0);
  });

  it("stops the plan when a step fails", async () => {
    const plan: Plan = {
      explanation: "two steps, first fails",
      steps: [
        {
          kind: "tool",
          tool: "file.stat",
          args: { path: "./missing-file-xyz" },
          reason: "will fail",
        },
        { kind: "shell", command: "echo should-not-run", reason: "never reached" },
      ],
    };
    const result = await runPlan("failing", plan, {
      assumeYes: false,
      allowMediumAutoApprove: false,
      timeoutSec: 5,
      autoApproveAll: true,
    });
    expect(result.status).toBe("failed");
    expect(result.outcomes).toHaveLength(1);
  });

  it("executes shell steps when approved (echo works everywhere)", async () => {
    const result = await runPlan("echo test", shellPlan("echo tau-shell-ok"), {
      assumeYes: false,
      allowMediumAutoApprove: false,
      timeoutSec: 5,
      autoApproveAll: true,
    });
    expect(result.status).toBe("ok");
    expect(result.output).toContain("tau-shell-ok");
  });

  it("skips remaining high-risk steps in assumeYes mode (non-interactive)", async () => {
    // rm of a regular file is "high" (caution list) — --yes must not run it.
    fs.writeFileSync("precious.txt", "keep me");
    const plan: Plan = {
      explanation: "delete a file",
      steps: [{ kind: "shell", command: "rm precious.txt", reason: "high risk" }],
    };
    const result = await runPlan("rm file", plan, {
      assumeYes: true,
      allowMediumAutoApprove: false,
      timeoutSec: 5,
      autoApproveAll: false,
      skipHistory: true,
    });
    expect(fs.existsSync("precious.txt")).toBe(true);
    expect(result.outcomes[0]?.skipped).toBe(true);
  });

  it("does not auto-run a medium-risk TOOL step under --yes when allowMediumAutoApprove is false", async () => {
    // file.rename is intrinsic-risk medium and mutates when execute:true.
    // The documented contract (README, docs/safety.md, types.ts): --yes
    // auto-approves low (and medium ONLY with the opt-in config) — the
    // non-TTY confirm falls back to "no", so the step must be skipped.
    fs.writeFileSync("report.txt", "data");
    const plan: Plan = {
      explanation: "rename report.txt",
      steps: [
        {
          kind: "tool",
          tool: "file.rename",
          args: { find: "report.txt", replace: "renamed.txt", execute: true },
          reason: "medium-risk mutating tool",
        },
      ],
    };
    const result = await runPlan("rename report", plan, {
      assumeYes: true,
      allowMediumAutoApprove: false,
      timeoutSec: 5,
      skipHistory: true,
    });
    expect(result.outcomes[0]?.skipped).toBe(true);
    expect(fs.existsSync("report.txt")).toBe(true);
    expect(fs.existsSync("renamed.txt")).toBe(false);
  });

  it("auto-runs a medium-risk TOOL step under --yes when allowMediumAutoApprove is true", async () => {
    fs.writeFileSync("report.txt", "data");
    const plan: Plan = {
      explanation: "rename report.txt",
      steps: [
        {
          kind: "tool",
          tool: "file.rename",
          args: { find: "report.txt", replace: "renamed.txt", execute: true },
          reason: "medium-risk mutating tool, opt-in auto-approve",
        },
      ],
    };
    const result = await runPlan("rename report", plan, {
      assumeYes: true,
      allowMediumAutoApprove: true,
      timeoutSec: 5,
      skipHistory: true,
    });
    expect(result.status).toBe("ok");
    expect(fs.existsSync("renamed.txt")).toBe(true);
    expect(fs.existsSync("report.txt")).toBe(false);
  });

  it("still auto-runs a low-risk TOOL step under --yes (benign lookalike)", async () => {
    // The read-only sibling of the mutating tools must keep sailing through.
    fs.writeFileSync("keep.txt", "x");
    const plan: Plan = {
      explanation: "find txt files",
      steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.txt" }, reason: "lookup" }],
    };
    const result = await runPlan("find txt", plan, {
      assumeYes: true,
      allowMediumAutoApprove: false,
      timeoutSec: 5,
      skipHistory: true,
    });
    expect(result.status).toBe("ok");
    expect(result.outcomes[0]?.skipped).toBeUndefined();
  });

  it("skips a high-risk TOOL step under --yes", async () => {
    // A skill-provided tool may declare risk: high — --yes must skip it
    // exactly like a high-risk shell step.
    if (!getTool("demo.dangerous")) {
      const dangerous: ToolDefinition = {
        name: "demo.dangerous",
        description: "demo tool with intrinsic high risk",
        params: [],
        risk: "high",
        owner: "demo",
        run: async () => ({ text: "RAN — should never happen under --yes" }),
      };
      registerTools([dangerous]);
    }
    const plan: Plan = {
      explanation: "run the dangerous demo tool",
      steps: [{ kind: "tool", tool: "demo.dangerous", args: {}, reason: "high-risk tool" }],
    };
    const result = await runPlan("dangerous demo", plan, {
      assumeYes: true,
      allowMediumAutoApprove: true, // even with medium opt-in, high stays manual
      timeoutSec: 5,
      skipHistory: true,
    });
    expect(result.outcomes[0]?.skipped).toBe(true);
    expect(result.outcomes[0]?.output).toContain("high risk step requires interactive approval");
  });
});
