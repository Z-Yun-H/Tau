/**
 * Reflection contract tests — validateReflectResponse acceptance/rejection
 * matrix, prompt construction, and the mock provider's deterministic
 * reflection decision table (the agent loop's offline fixture).
 */

import { describe, it, expect } from "vitest";
import {
  validateReflectResponse,
  buildReflectPrompt,
  truncateForFeedback,
  REFLECT_OUTPUT_SLICE,
} from "../src/reflect.js";
import { MockProvider } from "../src/providers/mock.js";
import { planningContext } from "../src/prompt.js";
import { registerCoreTools } from "@tau/tools";
import type { RoundFeedback } from "@tau/core";

registerCoreTools();

const doneJson = JSON.stringify({ done: true, answer: "all finished" });
const continueJson = JSON.stringify({
  done: false,
  explanation: "one more probe",
  steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.ts" }, reason: "probe" }],
  note: "continue",
});

const round = (overrides: Partial<RoundFeedback> = {}): RoundFeedback => ({
  round: 1,
  plan: {
    explanation: "find files",
    steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.ts" }, reason: "lookup" }],
  },
  status: "ok",
  outputs: ["a.ts\nb.ts"],
  ...overrides,
});

describe("validateReflectResponse", () => {
  it("accepts the done branch", () => {
    expect(validateReflectResponse(doneJson)).toEqual({ done: true, answer: "all finished" });
  });

  it("accepts the continue branch and reshapes steps like plan validation", () => {
    const decision = validateReflectResponse(continueJson);
    expect(decision).toEqual({
      done: false,
      plan: {
        explanation: "one more probe",
        steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.ts" }, reason: "probe" }],
      },
      note: "continue",
    });
  });

  it("continue without note omits the note field", () => {
    const decision = validateReflectResponse(
      JSON.stringify({
        done: false,
        explanation: "x",
        steps: [{ kind: "shell", command: "ls", reason: "r" }],
      }),
    );
    expect(decision.done).toBe(false);
    expect("note" in decision).toBe(false);
  });

  it("tolerates markdown fences and prose", () => {
    expect(validateReflectResponse(`\`\`\`json\n${doneJson}\n\`\`\``)).toEqual({
      done: true,
      answer: "all finished",
    });
    expect(validateReflectResponse(`Sure:\n${continueJson}\nDone.`).done).toBe(false);
  });

  it("rejects invalid JSON, missing answer, empty steps, and extra keys", () => {
    expect(() => validateReflectResponse("nope")).toThrow(/valid JSON/i);
    expect(() => validateReflectResponse(JSON.stringify({ done: true }))).toThrow(
      /schema validation/i,
    );
    expect(() =>
      validateReflectResponse(JSON.stringify({ done: false, explanation: "x", steps: [] })),
    ).toThrow(/schema validation/i);
    expect(() => validateReflectResponse(`${doneJson.slice(0, -1)}, "extra": 1}`)).toThrow(
      /schema validation/i,
    );
  });
});

describe("truncateForFeedback", () => {
  it("keeps short outputs verbatim", () => {
    expect(truncateForFeedback("short")).toBe("short");
  });
  it("truncates beyond the budget with a marker", () => {
    const out = truncateForFeedback("x".repeat(REFLECT_OUTPUT_SLICE + 10));
    expect(out.length).toBeLessThan(REFLECT_OUTPUT_SLICE + 40);
    expect(out).toContain("(output truncated)");
  });
});

describe("buildReflectPrompt", () => {
  it("carries intent, catalog, and executed rounds", () => {
    const ctx = {
      ...planningContext("build the widget", ""),
      rounds: [round({ round: 1 })],
    };
    const prompt = buildReflectPrompt(ctx);
    expect(prompt).toContain("INTENT: build the widget");
    expect(prompt).toContain("Round 1 — status: ok");
    expect(prompt).toContain("file.find");
    expect(prompt).toContain("a.ts");
    expect(prompt).toContain('"done": true');
  });

  it("summarizes dropped older rounds instead of dropping them silently", () => {
    const ctx = {
      ...planningContext("long goal", ""),
      rounds: [round({ round: 1 }), round({ round: 2 }), round({ round: 3 }), round({ round: 4 })],
    };
    const prompt = buildReflectPrompt(ctx);
    // 4 rounds, last 3 kept verbatim → exactly 1 summarized away.
    expect(prompt).toContain("1 earlier round(s) summarized");
    expect(prompt).toContain("Round 4 — status: ok");
    expect(prompt).not.toContain("Round 1 — status");
  });
});

describe("MockProvider.reflect decision table", () => {
  const provider = new MockProvider();
  const ctx = (rounds: RoundFeedback[]) => ({ ...planningContext("demo", ""), rounds });

  it("done when the last ok round's output carries GOAL_COMPLETE", async () => {
    const decision = await provider.reflect(
      ctx([round({ outputs: ["tau mock: GOAL_COMPLETE: task finished"] })]),
    );
    expect(decision).toEqual({ done: true, answer: "task finished" });
  });

  it("done with a bare marker answers the fallback phrase", async () => {
    const decision = await provider.reflect(ctx([round({ outputs: ["GOAL_COMPLETE"] })]));
    expect(decision).toEqual({ done: true, answer: "Goal complete." });
  });

  it("continues (deterministic probe) on ok without the marker", async () => {
    const decision = await provider.reflect(ctx([round()]));
    expect(decision.done).toBe(false);
    if (!decision.done) {
      expect(decision.plan.steps[0]?.kind).toBe("tool");
      expect(decision.plan.steps[0]?.tool).toBe("file.find");
      expect(decision.note).toBe("mock continue");
    }
  });

  it("proposes a low-risk repair round after a failed round", async () => {
    const decision = await provider.reflect(ctx([round({ status: "failed", outputs: ["boom"] })]));
    expect(decision.done).toBe(false);
    if (!decision.done) {
      expect(decision.plan.steps[0]?.kind).toBe("shell");
      expect(decision.note).toBe("mock repair");
    }
  });

  it("answers honestly when there is nothing to reflect on", async () => {
    const decision = await provider.reflect(ctx([]));
    expect(decision).toEqual({ done: true, answer: "No executed rounds to reflect on." });
  });
});
