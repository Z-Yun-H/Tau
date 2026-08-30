import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { selectFromList, promptHidden } from "../src/ui/picker.js";

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

describe("selectFromList — numbered fallback (non-TTY)", () => {
  it("picks by number", async () => {
    const input = new PassThrough();
    const output = collectingOutput();
    const pending = selectFromList({
      title: "Pick a model:",
      items: ["alpha", "beta", "gamma"],
      input,
      output,
    });
    await tick();
    input.write("2\n");
    await expect(pending).resolves.toBe(1);
    expect(output.text).toContain("Pick a model:");
    expect(output.text).toContain("1) alpha");
    expect(output.text).toContain("3) gamma");
  });

  it("marks the current entry", async () => {
    const input = new PassThrough();
    const output = collectingOutput();
    const pending = selectFromList({
      title: "t",
      items: ["one", "two"],
      activeIndex: 1,
      input,
      output,
    });
    await tick();
    input.write("\n"); // empty answer cancels
    await expect(pending).resolves.toBe(null);
    expect(output.text).toContain("2) two (current)");
  });

  it("resolves null for out-of-range and non-numeric answers", async () => {
    const input = new PassThrough();
    const pending = selectFromList({
      title: "t",
      items: ["a"],
      input,
      output: collectingOutput(),
    });
    await tick();
    input.write("9\n");
    await expect(pending).resolves.toBe(null);

    const input2 = new PassThrough();
    const pending2 = selectFromList({
      title: "t",
      items: ["a"],
      input: input2,
      output: collectingOutput(),
    });
    await tick();
    input2.write("nope\n");
    await expect(pending2).resolves.toBe(null);
  });

  it("short-circuits for empty item lists", async () => {
    const result = await selectFromList({
      title: "t",
      items: [],
      input: new PassThrough(),
      output: collectingOutput(),
    });
    expect(result).toBe(null);
  });
});

describe("selectFromList — keypress UI (TTY)", () => {
  it("enters raw mode, moves with arrows and selects with enter", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = selectFromList({ title: "t", items: ["a", "b", "c"], input, output });
    await tick();
    expect(input.isRaw).toBe(true); // raw mode active while picking
    input.write("\x1b[B"); // down
    await tick();
    input.write("\r"); // enter
    await expect(pending).resolves.toBe(1);
    expect(input.isRaw).toBe(false); // restored afterwards
    expect(output.text).toContain("b\n");
  });

  it("escape cancels", async () => {
    const input = new FakeTTY();
    const pending = selectFromList({
      title: "t",
      items: ["a", "b"],
      input,
      output: collectingOutput(),
    });
    await tick();
    input.write("\x1b");
    await expect(pending).resolves.toBe(null);
  });

  it("supports vim keys (j/k) and highlights the current entry", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = selectFromList({
      title: "t",
      items: ["a", "b"],
      activeIndex: 0,
      input,
      output,
    });
    await tick();
    expect(output.text).toContain("(current)");
    input.write("j"); // down
    await tick();
    input.write("\r");
    await expect(pending).resolves.toBe(1);
  });
});

describe("promptHidden", () => {
  it("collects characters without echoing them", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = promptHidden("key: ", { input, output });
    await tick();
    input.write("abc");
    await tick();
    input.write("\r");
    await expect(pending).resolves.toBe("abc");
    expect(output.text).toContain("***");
    expect(output.text).not.toContain("abc");
  });

  it("backspace edits the input", async () => {
    const input = new FakeTTY();
    const output = collectingOutput();
    const pending = promptHidden("key: ", { input, output });
    await tick();
    input.write("se");
    await tick();
    input.write("\x7f"); // backspace -> "s"
    await tick();
    input.write("ecret\r");
    await expect(pending).resolves.toBe("secret");
    expect(output.text).toContain("\b \b");
  });

  it("refuses to run without a TTY", async () => {
    await expect(
      promptHidden("key: ", { input: new PassThrough(), output: collectingOutput() }),
    ).rejects.toThrow(/terminal is required/i);
  });
});
