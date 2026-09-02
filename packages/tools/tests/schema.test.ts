/**
 * Function-calling schema export tests — ToolParamSpec → JSON Schema mapping,
 * the dotted-name → wire-safe function-name mapping (dot → `__`), and the
 * fail-fast guards (collision, >64-char names).
 *
 * AGENTS/ai-integration.md: the planner may bind tools natively via the
 * OpenAI-compatible `tools` wire field; this export is the bridge. The
 * deterministic safety reviewer still grades every plan — exporting a schema
 * never bypasses it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { ToolDefinition } from "@tau/core";
import {
  allTools,
  functionNameFor,
  functionTools,
  getTool,
  registerCoreTools,
  registerTools,
  resetRegistry,
  toolNameFor,
  toolParametersJsonSchema,
} from "../src/index.js";

beforeEach(() => {
  resetRegistry();
  registerCoreTools();
});

describe("functionNameFor", () => {
  it("maps dotted tool names to double-underscore function names", () => {
    expect(functionNameFor("file.find")).toBe("file__find");
    expect(functionNameFor("git-helper.status")).toBe("git-helper__status");
  });

  it("round-trips through toolNameFor", () => {
    for (const tool of allTools()) {
      expect(toolNameFor(functionNameFor(tool.name))).toBe(tool.name);
    }
  });

  it("throws on names that exceed the 64-char wire limit after mapping", () => {
    const longSkill = "x".repeat(63) + ".cmd";
    expect(() => functionNameFor(longSkill)).toThrow(/64-char wire limit/);
  });
});

describe("functionTools", () => {
  it("exports every registered tool with the wire-safe name grammar", () => {
    const fns = functionTools();
    expect(fns.length).toBe(allTools().length);
    for (const fn of fns) {
      expect(fn.type).toBe("function");
      expect(fn.function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(fn.function.name).not.toContain(".");
      expect(fn.function.description.length).toBeGreaterThan(0);
    }
  });

  it("carries risk/mutates/dry-run tags in the description like the text catalog", () => {
    const rename = functionTools().find((f) => f.function.name === "file__rename")!;
    expect(rename.function.description).toContain("[risk:medium, mutates, dry-run-default]");
    const find = functionTools().find((f) => f.function.name === "file__find")!;
    expect(find.function.description).not.toContain("mutates");
  });

  it("maps param types, required set, and defaults into JSON Schema", () => {
    const find = getTool("file.find")!;
    const schema = toolParametersJsonSchema(find);
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    for (const param of find.params) {
      const prop = schema.properties[param.name]!;
      if (param.type === "string[]") {
        expect(prop.type).toBe("array");
        expect(prop.items).toEqual({ type: "string" });
      } else {
        expect(prop.type).toBe(param.type);
      }
      if (param.required) expect(schema.required).toContain(param.name);
      if (param.default !== undefined) {
        expect(prop.description).toContain("Defaults to");
      }
    }
  });

  it("keeps an empty required list and empty properties valid for arg-less tools", () => {
    const argless = allTools().find((t) => t.params.length === 0);
    if (!argless) return; // every current tool takes params; guard for future ops
    const schema = toolParametersJsonSchema(argless);
    expect(schema.required).toEqual([]);
    expect(schema.properties).toEqual({});
  });

  it("fails fast on a function-name collision after dot mapping", () => {
    const a: ToolDefinition = syntheticTool("a__b.c");
    const b: ToolDefinition = syntheticTool("a.b__c");
    // Both map to "a____b__c"? No — a__b.c → a____b__c and a.b__c → a____b__c.
    expect(functionNameFor("a__b.c")).toBe(functionNameFor("a.b__c"));
    registerTools([a], { replace: true });
    expect(() => {
      registerTools([b], { replace: true });
      functionTools();
    }).toThrow(/collision/);
  });
});

/** Minimal ToolDefinition factory for registry-level guards. */
function syntheticTool(name: string): ToolDefinition {
  return {
    name,
    description: "synthetic tool for collision tests",
    params: [],
    risk: "low",
    owner: "core",
    run: async () => ({ text: "" }),
  };
}
