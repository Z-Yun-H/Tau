import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerCoreTools, getTool } from "../src/index.js";

let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-text-"));
  process.chdir(tmp);
  registerCoreTools();
});

afterEach(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
  fs.writeFileSync(path.join(tmp, rel), content);
}

describe("text.search", () => {
  it("finds matches with line numbers", async () => {
    writeFile("src/a.ts", "const one = 1;\nconst TODO = true;\n");
    writeFile("src/b.ts", "// TODO fix\n");
    const result = await getTool("text.search")!.run({ pattern: "TODO", glob: "*.ts" });
    expect(result.text).toContain("src/a.ts:2:");
    expect(result.text).toContain("src/b.ts:1:");
  });

  it("skips .git, node_modules and binaries", async () => {
    writeFile("visible.txt", "needle here");
    writeFile("node_modules/x.txt", "needle in junk");
    fs.mkdirSync(".git");
    fs.writeFileSync(".git/packed", "needle in git");
    fs.writeFileSync("binary.bin", Buffer.from([0x00, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00]));

    const result = await getTool("text.search")!.run({ pattern: "needle", glob: "*" });
    expect(result.text).toContain("visible.txt");
    expect(result.text).not.toContain("node_modules");
    expect(result.text).not.toContain(".git");
    expect(result.text).not.toContain("binary.bin");
  });

  it("supports ignoreCase", async () => {
    writeFile("case.txt", "MIXED Case\n");
    const result = await getTool("text.search")!.run({
      pattern: "mixed case",
      glob: "*.txt",
      ignoreCase: true,
    });
    expect(result.text).toContain("1 match");
  });
});

describe("text.replace", () => {
  it("dry-runs by default and reports counts", async () => {
    writeFile("a.txt", "foo bar foo\n");
    const result = await getTool("text.replace")!.run({
      find: "foo",
      replace: "baz",
      glob: "*.txt",
    });
    expect(result.text).toContain("DRY RUN");
    expect(result.text).toContain("2 replacement(s)");
    expect(fs.readFileSync("a.txt", "utf8")).toContain("foo");
  });

  it("applies with execute:true", async () => {
    writeFile("a.txt", "foo bar foo\n");
    writeFile("b.txt", "no match here\n");
    const result = await getTool("text.replace")!.run({
      find: "foo",
      replace: "baz",
      glob: "*.txt",
      execute: true,
    });
    expect(result.text).toContain("Applied 2 replacement");
    expect(fs.readFileSync("a.txt", "utf8")).toBe("baz bar baz\n");
  });

  it("requires non-empty find", async () => {
    await expect(getTool("text.replace")!.run({ find: "", replace: "x" })).rejects.toThrow(
      /requires find and replace/i,
    );
  });
});

describe("text.count", () => {
  it("counts lines/words/chars/unique", async () => {
    writeFile("c.txt", "alpha beta alpha\ngamma\n");
    const result = await getTool("text.count")!.run({ path: "c.txt" });
    expect(result.text).toContain("lines: 2");
    expect(result.text).toContain("words: 3");
    expect(result.text).toContain("unique words: 3");
  });
});
