import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPlan } from "../src/core/session.js";
import { registerCoreTools } from "@tau/tools";
import { readHistory } from "@tau/core";
import type { Plan } from "@tau/core";

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
});
