import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerCoreTools, getTool } from "../../src/tools/index.js";

let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-file-"));
  process.chdir(tmp);
  registerCoreTools();
});

afterEach(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("file.find", () => {
  it("finds files by glob and prunes node_modules", async () => {
    fs.mkdirSync(path.join(tmp, "src"));
    fs.mkdirSync(path.join(tmp, "node_modules", "junk"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "a.ts"), "export {};");
    fs.writeFileSync(path.join(tmp, "b.ts"), "export {};");
    fs.writeFileSync(path.join(tmp, "node_modules", "junk", "c.ts"), "export {};");

    const result = await getTool("file.find")!.run({ pattern: "*.ts" });
    expect(result.text).toContain("2 match(es)");
    expect(result.text).toContain("src/a.ts");
    expect(result.text).not.toContain("node_modules");
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) fs.writeFileSync(`f${i}.txt`, "x");
    const result = await getTool("file.find")!.run({ pattern: "*.txt", limit: 2 });
    expect(result.text).toContain("showing first 2");
  });

  it("throws on missing path", async () => {
    await expect(getTool("file.find")!.run({ pattern: "*", path: "./nope" })).rejects.toThrow(
      /does not exist/i,
    );
  });
});

describe("file.tree", () => {
  it("renders a pruned tree", async () => {
    fs.mkdirSync("pkg/lib", { recursive: true });
    fs.writeFileSync("pkg/lib/core.ts", "x");
    fs.writeFileSync("pkg/readme.md", "x");
    const result = await getTool("file.tree")!.run({ path: ".", depth: 3 });
    expect(result.text).toContain("pkg/");
    expect(result.text).toContain("core.ts");
    expect(result.text).toContain("└──");
  });
});

describe("file.stat", () => {
  it("reports type and size", async () => {
    fs.writeFileSync("hello.txt", "12345");
    const result = await getTool("file.stat")!.run({ path: "hello.txt" });
    expect(result.text).toContain("type: file");
    expect(result.text).toContain("size: 5 bytes");
  });
});

describe("file.rename", () => {
  it("is dry-run by default", async () => {
    fs.writeFileSync("report-v1.txt", "x");
    fs.writeFileSync("report-v2.txt", "x");
    const result = await getTool("file.rename")!.run({
      find: "-v(\\d+)",
      replace: "-final$1",
      path: ".",
    });
    expect(result.text).toContain("DRY RUN");
    expect(fs.existsSync("report-v1.txt")).toBe(true);
  });

  it("applies renames only with execute:true and skips existing targets", async () => {
    fs.writeFileSync("report-v1.txt", "x");
    fs.writeFileSync("report-v2.txt", "x");
    fs.writeFileSync("report-final1.txt", "occupied");

    const result = await getTool("file.rename")!.run({
      find: "-v(\\d+)",
      replace: "-final$1",
      path: ".",
      execute: true,
    });
    expect(result.text).toContain("Renamed");
    // Target existed -> source kept, rename skipped.
    expect(fs.existsSync("report-v1.txt")).toBe(true);
    expect(result.text).toContain("SKIP");
    // Free target -> renamed.
    expect(fs.existsSync("report-v2.txt")).toBe(false);
    expect(fs.existsSync("report-final2.txt")).toBe(true);
  });

  it("requires find and replace", async () => {
    await expect(getTool("file.rename")!.run({})).rejects.toThrow(/requires find and replace/i);
  });
});
