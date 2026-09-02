/**
 * Registry catalog rendering tests — the grouped format + mutation/dry-run
 * tags + the catalog summary line that buildSystemPrompt embeds.
 *
 * AGENTS/ai-integration.md "prefer DRY-RUN modes" + "prefer tools over shell":
 * the catalog must surface read-only vs mutates + dry-run-default so the
 * planner can prefer them.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  allTools,
  catalogSummary,
  registerCoreTools,
  renderToolCatalog,
  resetRegistry,
} from "../src/index.js";

beforeEach(() => {
  resetRegistry();
  registerCoreTools();
});

describe("renderToolCatalog", () => {
  it("groups tools by family with a count header", () => {
    const catalog = renderToolCatalog();
    // Core families present with their counts in the `## family (N)` header.
    expect(catalog).toContain("## file (");
    expect(catalog).toContain("## sys (");
    expect(catalog).toContain("## net (");
    expect(catalog).toContain("## text (");
  });

  it("tags mutation tools with [mutates] and dry-run tools with [dry-run-default]", () => {
    const catalog = renderToolCatalog();
    // file.rename is the canonical mutates + dry-run-default tool.
    const renameLine = catalog.split("\n").find((l) => l.startsWith("- file.rename "));
    expect(renameLine).toBeDefined();
    expect(renameLine).toContain("mutates");
    expect(renameLine).toContain("dry-run-default");
    // text.replace is the other mutates + dry-run-default tool.
    const replaceLine = catalog.split("\n").find((l) => l.startsWith("- text.replace "));
    expect(replaceLine).toBeDefined();
    expect(replaceLine).toContain("mutates");
    expect(replaceLine).toContain("dry-run-default");
  });

  it("does NOT tag read-only tools with mutates", () => {
    const catalog = renderToolCatalog();
    const findLine = catalog.split("\n").find((l) => l.startsWith("- file.find "));
    expect(findLine).toBeDefined();
    expect(findLine).not.toContain("mutates");
    expect(findLine).not.toContain("dry-run-default");
  });

  it("still carries the risk tag and params for every tool", () => {
    const catalog = renderToolCatalog();
    expect(catalog).toContain("- file.find [risk:low]");
    expect(catalog).toContain("- file.rename [risk:medium, mutates, dry-run-default]");
    expect(catalog).toContain("params: (pattern:string, path?:string=opt");
  });

  it("returns a placeholder when the registry is empty", () => {
    resetRegistry();
    expect(renderToolCatalog()).toBe("(no tools registered)");
  });
});

describe("catalogSummary", () => {
  it("reports tool/family counts and the read/mut split", () => {
    const summary = catalogSummary();
    // 4 core families (file/sys/net/text); 2 mutates (file.rename, text.replace).
    expect(summary).toMatch(/\d+ tools across 4 families \(\d+ read \/ 2 mutates\)/);
  });

  it("degrades to a zero-count line when the registry is empty", () => {
    resetRegistry();
    expect(catalogSummary()).toBe("0 tools");
  });

  it("stays in sync with allTools().length", () => {
    const summary = catalogSummary();
    const count = Number(summary.match(/^(\d+) tools/)?.[1]);
    expect(count).toBe(allTools().length);
  });
});
