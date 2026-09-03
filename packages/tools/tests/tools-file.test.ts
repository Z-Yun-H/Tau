import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerCoreTools, getTool, languageForFile } from "../src/index.js";

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

  it("filters by type=file (directories excluded even when the glob matches them)", async () => {
    fs.mkdirSync("sub");
    fs.writeFileSync("keep.ts", "x");
    const result = await getTool("file.find")!.run({ pattern: "**", type: "file" });
    expect(result.text).toContain("keep.ts");
    expect(result.text).not.toContain("sub/");
  });

  it("filters by type=dir (files excluded)", async () => {
    fs.mkdirSync("sub");
    fs.writeFileSync("keep.ts", "x");
    const result = await getTool("file.find")!.run({ pattern: "**", type: "dir" });
    expect(result.text).toContain("sub/");
    expect(result.text).not.toContain("keep.ts");
  });
});

describe("file.read", () => {
  it("reads a text file with line numbers and honors offset/limit", async () => {
    fs.writeFileSync("poem.txt", "alpha\nbeta\ngamma\ndelta\n");
    const all = await getTool("file.read")!.run({ path: "poem.txt" });
    expect(all.text).toContain("1  alpha");
    expect(all.text).toContain("4  delta");
    const windowed = await getTool("file.read")!.run({ path: "poem.txt", offset: 2, limit: 2 });
    expect(windowed.text).toContain("2  beta");
    expect(windowed.text).toContain("3  gamma");
    expect(windowed.text).not.toContain("4  delta");
    expect(windowed.text).toContain("(truncated");
  });

  it("refuses directories, missing paths and binary files", async () => {
    fs.mkdirSync("adir");
    await expect(getTool("file.read")!.run({ path: "adir" })).rejects.toThrow(/directory/i);
    await expect(getTool("file.read")!.run({ path: "nope.txt" })).rejects.toThrow(
      /does not exist/i,
    );
    fs.writeFileSync("blob.bin", Buffer.from([0x7f, 0x00, 0x01]));
    await expect(getTool("file.read")!.run({ path: "blob.bin" })).rejects.toThrow(/binary/i);
  });

  it("reports path and detected language in the structured result", async () => {
    fs.writeFileSync("app.ts", "export {};\n");
    const result = await getTool("file.read")!.run({ path: "app.ts" });
    const data = result.data as { path: string; language: string; totalLines: number };
    expect(data.path).toBe("app.ts");
    expect(data.language).toBe("typescript");
    expect(data.totalLines).toBe(2);
  });

  it("falls back to language text for unknown extensions", async () => {
    fs.writeFileSync("data.weird", "x\n");
    const result = await getTool("file.read")!.run({ path: "data.weird" });
    expect((result.data as { language: string }).language).toBe("text");
  });
});

describe("languageForFile", () => {
  it("maps common extensions to shiki language ids", () => {
    expect(languageForFile("a.ts")).toBe("typescript");
    expect(languageForFile("Component.tsx")).toBe("typescript");
    expect(languageForFile("script.mjs")).toBe("javascript");
    expect(languageForFile("pkg.json")).toBe("json");
    expect(languageForFile("main.py")).toBe("python");
    expect(languageForFile("config.yml")).toBe("yaml");
    expect(languageForFile("README.md")).toBe("markdown");
    expect(languageForFile("index.html")).toBe("html");
    expect(languageForFile("style.css")).toBe("css");
    expect(languageForFile("run.sh")).toBe("bash");
    expect(languageForFile("main.go")).toBe("go");
    expect(languageForFile("lib.rs")).toBe("rust");
    expect(languageForFile("App.java")).toBe("java");
    expect(languageForFile("mem.c")).toBe("c");
    expect(languageForFile("mem.cpp")).toBe("cpp");
    expect(languageForFile("query.sql")).toBe("sql");
    expect(languageForFile("Cargo.toml")).toBe("toml");
  });

  it("recognizes special filenames case-insensitively", () => {
    expect(languageForFile("Dockerfile")).toBe("dockerfile");
    expect(languageForFile("dockerfile")).toBe("dockerfile");
    expect(languageForFile("Makefile")).toBe("makefile");
    expect(languageForFile("Gemfile")).toBe("ruby");
  });

  it("uses the last extension for multi-dot names", () => {
    expect(languageForFile("file.test.ts")).toBe("typescript");
    expect(languageForFile("archive.tar.gz")).toBe("text");
  });

  it("returns text for extension-less files, dotfiles and unknown extensions", () => {
    expect(languageForFile("LICENSE")).toBe("text");
    expect(languageForFile(".gitignore")).toBe("text");
    expect(languageForFile("data.weird")).toBe("text");
    expect(languageForFile("nested/dir/app.vue")).toBe("vue");
  });
});

describe("file.list", () => {
  it("lists one directory non-recursively, hiding dotfiles by default", async () => {
    fs.mkdirSync("pkg");
    fs.writeFileSync("pkg/a.ts", "export {};");
    fs.writeFileSync(".hidden", "x");
    const result = await getTool("file.list")!.run({ path: "." });
    expect(result.text).toContain("pkg/");
    expect(result.text).not.toContain(".hidden");
    const withHidden = await getTool("file.list")!.run({ path: ".", includeHidden: true });
    expect(withHidden.text).toContain(".hidden");
  });

  it("throws on non-directories", async () => {
    fs.writeFileSync("plain.txt", "x");
    await expect(getTool("file.list")!.run({ path: "plain.txt" })).rejects.toThrow(
      /not a directory/i,
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
