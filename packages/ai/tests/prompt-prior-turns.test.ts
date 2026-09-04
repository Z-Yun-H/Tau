import { describe, expect, it } from "vitest";
import type { PriorTurn } from "@tau/core";
import { planningContext, renderPriorTurns } from "../src/prompt.js";

const TURNS: PriorTurn[] = [
  { role: "user", text: "find the big log files" },
  { role: "assistant", text: "I planned file.find on /var/log and printed the largest three." },
  { role: "user", text: "now compress them" },
];

describe("planningContext — prior turns (conversation mode)", () => {
  it("is byte-identical to the pre-U4 shape when no turns are given", () => {
    const bare = planningContext("compress logs", "SKILLS");
    const empty = planningContext("compress logs", "SKILLS", []);
    expect(empty.intent).toBe(bare.intent);
    expect(bare.intent).toBe("compress logs");
    expect(bare.intent).not.toContain("<conversation>");
  });

  it("folds prior turns into the presented intent and keeps the request last", () => {
    const ctx = planningContext("now compress them", "SKILLS", TURNS);
    expect(ctx.intent).toContain("<conversation>");
    expect(ctx.intent).toContain("user: find the big log files");
    expect(ctx.intent).toContain("assistant: I planned file.find");
    expect(ctx.intent).toMatch(/<\/conversation>\n\nCurrent request: now compress them$/);
    // catalogs and environment are untouched
    expect(ctx.skillCatalog).toBe("SKILLS");
    expect(ctx.toolCatalog.length).toBeGreaterThan(0);
  });

  it("keeps only the last 12 turns", () => {
    const many: PriorTurn[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `turn ${i}`,
    }));
    const rendered = planningContext("go", "SKILLS", many).intent;
    expect(rendered).toContain("turn 19");
    expect(rendered).toContain("turn 8"); // first of the last 12
    expect(rendered).not.toContain("turn 7\n"); // trimmed head
    expect(rendered).not.toContain("turn 0");
  });

  it("truncates oversized turn texts", () => {
    const long = "x".repeat(5000);
    const rendered = renderPriorTurns([{ role: "user", text: long }]);
    expect(rendered).toContain("…");
    expect(rendered.length).toBeLessThan(long.length);
  });
});
