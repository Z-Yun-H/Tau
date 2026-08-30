import { describe, it, expect } from "vitest";
import { validatePlanResponse, buildSystemPrompt, planningContext } from "../../src/ai/prompt.js";
import { registerCoreTools } from "../../src/tools/index.js";

// Ensure the catalog has content for prompt tests.
registerCoreTools();

describe("validatePlanResponse", () => {
  it("accepts strict JSON", () => {
    const plan = validatePlanResponse(
      JSON.stringify({
        explanation: "find ts files",
        steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.ts" }, reason: "lookup" }],
        selfAssessedRisk: "low",
      }),
    );
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.tool).toBe("file.find");
    expect(plan.steps[0]?.reason).toBe("lookup");
  });

  it("tolerates markdown-fenced JSON", () => {
    const plan = validatePlanResponse(
      '```json\n{"explanation":"x","steps":[{"kind":"shell","command":"ls","reason":"r"}]}\n```',
    );
    expect(plan.steps[0]?.kind).toBe("shell");
  });

  it("tolerates prose around the JSON object", () => {
    const plan = validatePlanResponse(
      'Here is the plan you asked for:\n{"explanation":"x","steps":[{"kind":"shell","command":"ls","reason":"r"}]}\nHope that helps!',
    );
    expect(plan.explanation).toBe("x");
  });

  it("throws on invalid JSON", () => {
    expect(() => validatePlanResponse("not json at all")).toThrow(/valid JSON/i);
  });

  it("throws on schema violations (extra keys, bad enums)", () => {
    expect(() => validatePlanResponse('{"explanation":"x","steps":[{"kind":"magic"}]}')).toThrow(
      /validation/i,
    );
    expect(() =>
      validatePlanResponse(
        '{"explanation":"x","steps":[{"kind":"shell","command":"ls","reason":"r"}],"unexpected":true}',
      ),
    ).toThrow(/validation/i);
  });

  it("rejects plans with zero or too many steps", () => {
    expect(() => validatePlanResponse('{"explanation":"x","steps":[]}')).toThrow();
    const many = Array.from({ length: 11 }, () => '{"kind":"shell","command":"ls","reason":"r"}');
    expect(() => validatePlanResponse(`{"explanation":"x","steps":[${many.join(",")}]}`)).toThrow();
  });

  it("normalizes missing reason to empty string", () => {
    const plan = validatePlanResponse(
      '{"explanation":"x","steps":[{"kind":"shell","command":"ls"}]}',
    );
    expect(plan.steps[0]?.reason).toBe("");
  });
});

describe("buildSystemPrompt", () => {
  const ctx = planningContext("find all ts files", "- some-skill v1: does things");

  it("embeds the real tool catalog", () => {
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("file.find");
    expect(prompt).toContain("sys.disk");
    expect(prompt).toContain("text.search");
  });

  it("embeds the skill catalog and environment", () => {
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("some-skill");
    expect(prompt).toContain(`platform=${process.platform}`);
  });

  it("is deterministic for the same context", () => {
    expect(buildSystemPrompt(ctx)).toBe(buildSystemPrompt(ctx));
  });
});
