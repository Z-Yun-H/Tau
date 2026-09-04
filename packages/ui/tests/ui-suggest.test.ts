import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { suggestFromList, type SuggestItem } from "../src/suggest.js";

const tick = async (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A TTY-flavoured PassThrough so the keypress path can be driven in tests. */
class FakeTTY extends PassThrough {
  isTTY = true;
  isRaw = false;
  setRawMode(mode: boolean): boolean {
    this.isRaw = mode;
    return mode;
  }
}

function collectingOutput(): PassThrough & { text: string } {
  const stream = new PassThrough() as PassThrough & { text: string };
  stream.text = "";
  stream.on("data", (chunk: Buffer) => {
    stream.text += chunk.toString("utf8");
  });
  return stream;
}

const ITEMS: SuggestItem[] = [
  { value: "/clear", usage: "/clear", description: "clear the screen" },
  { value: "/exit", usage: "/exit", description: "leave the session" },
  { value: "/md ", usage: "/md <file>", description: "preview a markdown file" },
  { value: "/provider", usage: "/provider", description: "active provider" },
  { value: "/status", usage: "/status", description: "runtime locations" },
];

describe("suggestFromList — non-TTY dismissal", () => {
  it("dismisses immediately without a raw-capable stream", async () => {
    const input = new PassThrough(); // no isTTY, no setRawMode
    const output = collectingOutput();
    await expect(
      suggestFromList({ initialFilter: "/", items: ITEMS, input, output }),
    ).resolves.toEqual({ action: "dismiss", value: null, filter: "/" });
    expect(output.text).toBe("");
  });

  it("dismisses immediately when there are no items", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    await expect(
      suggestFromList({ initialFilter: "/", items: [], input, output }),
    ).resolves.toEqual({ action: "dismiss", value: null, filter: "/" });
  });
});

describe("suggestFromList — interactive palette", () => {
  it("filters as the user types and selects with enter", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = suggestFromList({ initialFilter: "/", items: ITEMS, input, output });
    await tick();
    expect(output.text).toContain("❯ /clear");
    input.write("pro"); // → /pro → /provider
    await tick();
    expect(output.text).toContain("❯ /provider  active provider");
    input.write("\r");
    await expect(pending).resolves.toEqual({
      action: "select",
      value: "/provider",
      filter: "/pro",
    });
  });

  it("keeps items with a trailing space intact on selection", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = suggestFromList({ initialFilter: "/", items: ITEMS, input, output });
    await tick();
    input.write("md"); // → /md → /md (trailing space preserved in value)
    await tick();
    input.write("\t"); // tab selects too
    await expect(pending).resolves.toEqual({ action: "select", value: "/md ", filter: "/md" });
  });

  it("navigates with arrows and wraps at the edges", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = suggestFromList({ initialFilter: "/", items: ITEMS, input, output });
    await tick();
    input.write("\x1b[A"); // up from index 0 clamps to the first row
    await tick();
    input.write("\r");
    await expect(pending).resolves.toEqual({ action: "select", value: "/clear", filter: "/" });
  });

  it("moves down twice before selecting", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = suggestFromList({ initialFilter: "/", items: ITEMS, input, output });
    await tick();
    input.write("\x1b[B\x1b[B"); // down twice → /md
    await tick();
    input.write("\r");
    await expect(pending).resolves.toEqual({ action: "select", value: "/md ", filter: "/" });
  });

  it("dismisses with escape and reports the filter for buffer sync", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = suggestFromList({ initialFilter: "/", items: ITEMS, input, output });
    await tick();
    input.write("st"); // /st → /status
    await tick();
    input.write("\x1b"); // esc
    await expect(pending).resolves.toEqual({ action: "dismiss", value: null, filter: "/st" });
  });

  it("auto-dismisses when backspacing the initial slash away", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = suggestFromList({ initialFilter: "/", items: ITEMS, input, output });
    await tick();
    input.write("\x7f"); // backspace
    await expect(pending).resolves.toEqual({ action: "dismiss", value: null, filter: "" });
  });

  it("keeps the palette open when a caller-provided filter empties", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = suggestFromList({ initialFilter: "", items: ITEMS, input, output });
    await tick();
    input.write("x\x7f"); // type then backspace back to ""
    await tick();
    expect(output.text).toContain("no matching command");
    input.write("\x1b");
    await expect(pending).resolves.toEqual({ action: "dismiss", value: null, filter: "" });
  });

  it("shows the no-match row for unknown prefixes", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = suggestFromList({ initialFilter: "/", items: ITEMS, input, output });
    await tick();
    input.write("zzz");
    await tick();
    expect(output.text).toContain("no matching command");
    input.write("\r"); // enter with no matches dismisses
    await expect(pending).resolves.toEqual({ action: "dismiss", value: null, filter: "/zzz" });
  });

  it("scrolls the viewport and reports the count", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const many: SuggestItem[] = Array.from({ length: 12 }, (_, i) => ({
      value: `/cmd${i}`,
      usage: `/cmd${i}`,
      description: `command ${i}`,
    }));
    const pending = suggestFromList({
      initialFilter: "/",
      items: many,
      input,
      output,
      viewport: 4,
    });
    await tick();
    input.write("\x1b[B\x1b[B\x1b[B\x1b[B"); // down 4 → window must slide
    await tick();
    expect(output.text).toContain("5/12");
    expect(output.text).toContain("❯ /cmd4  command 4");
    input.write("\r");
    await expect(pending).resolves.toEqual({ action: "select", value: "/cmd4", filter: "/" });
  });

  it("keeps the same item under the cursor while filtering", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = suggestFromList({ initialFilter: "/", items: ITEMS, input, output });
    await tick();
    input.write("\x1b[B\x1b[B"); // cursor on /md
    await tick();
    input.write("m"); // /m matches /md only → cursor stays on /md
    await tick();
    input.write("\r");
    await expect(pending).resolves.toEqual({ action: "select", value: "/md ", filter: "/m" });
  });

  it("restores raw mode to its prior state on every exit path", async () => {
    const input = new FakeTTY();
    input.setRawMode(true); // simulate readline's already-raw stdin
    const output = collectingOutput();
    const pending = suggestFromList({ initialFilter: "/", items: ITEMS, input, output });
    await tick();
    input.write("\x1b");
    await pending;
    expect(input.isRaw).toBe(true);
  });
});
