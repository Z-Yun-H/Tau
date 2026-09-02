/**
 * Safety reviewer path-layer escalation for the write primitive (issue #96).
 * The reviewer is only ever STRENGTHENED (golden rule 1): file.write steps
 * get an independent path check on top of the tool's own refusals.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reviewPlan } from "../src/safety.js";
import { registerCoreTools, resetRegistry } from "@tau/tools";
import type { Plan } from "@tau/core";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-safety-write-"));
  process.chdir(tmp);
  registerCoreTools();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tmp, { recursive: true, force: true });
  resetRegistry();
});

const planWithWrite = (writePath: string): Plan => ({
  explanation: "write a file",
  steps: [
    { kind: "tool", tool: "file.write", args: { path: writePath, content: "x" }, reason: "r" },
  ],
});

describe("reviewPlan — file.write path escalation", () => {
  it("blocks writes into system locations", () => {
    const review = reviewPlan(planWithWrite("/etc/cron.d/evil"));
    expect(review.verdict).toBe("deny");
    expect(review.overallRisk).toBe("blocked");
    expect(review.issues.some((issue) => issue.message.includes("system location"))).toBe(true);
  });

  it("escalates workspace escapes to high (interactive confirm)", () => {
    const review = reviewPlan(planWithWrite("../outside.txt"));
    expect(review.verdict).toBe("review");
    expect(review.overallRisk).toBe("high");
    expect(review.issues.some((issue) => issue.message.includes("escapes the workspace"))).toBe(
      true,
    );
  });

  it("leaves ordinary in-workspace writes at the tool's intrinsic medium risk", () => {
    const review = reviewPlan(planWithWrite("notes/todo.md"));
    expect(review.verdict).toBe("review"); // medium risk needs confirmation
    expect(review.overallRisk).toBe("medium");
    expect(review.issues).toHaveLength(0); // no path issues added
  });

  it("ignores the path layer for other tools (no widening)", () => {
    const plan: Plan = {
      explanation: "find files",
      steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*", path: "." }, reason: "r" }],
    };
    const review = reviewPlan(plan);
    expect(review.verdict).toBe("allow"); // low risk, no issues
    expect(review.issues).toHaveLength(0);
  });

  it("file.write steps without a string path fall back to the tool's intrinsic risk", () => {
    const plan: Plan = {
      explanation: "missing path",
      steps: [{ kind: "tool", tool: "file.write", args: { content: "x" }, reason: "r" }],
    };
    const review = reviewPlan(plan);
    expect(review.overallRisk).toBe("medium");
    expect(review.issues).toHaveLength(0);
  });
});
