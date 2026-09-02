/**
 * file.write tests — the first-party write primitive: dry-run default,
 * execute path, append mode, containment refusals, binary guard (issue #96).
 * The safety reviewer's independent path escalation lives in
 * packages/engine/tests/safety-write.test.ts (engine depends on tools,
 * never the reverse).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTool, registerCoreTools, resetRegistry } from "@tau/tools";
import { escapesWorkspace, isSystemWritePath } from "../src/file.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-write-"));
  process.chdir(tmp);
  resetRegistry();
  registerCoreTools();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tmp, { recursive: true, force: true });
  resetRegistry();
});

const write = (): NonNullable<ReturnType<typeof getTool>> => {
  const tool = getTool("file.write");
  if (!tool) throw new Error("file.write not registered");
  return tool;
};

describe("file.write tool", () => {
  it("is registered as a mutating, dry-run-default, medium-risk tool", () => {
    const tool = write();
    expect(tool.mutates).toBe(true);
    expect(tool.dryRunDefault).toBe(true);
    expect(tool.risk).toBe("medium");
  });

  it("dry run (default) previews and writes nothing", async () => {
    const result = await write().run({ path: "notes/a.md", content: "# hi\nsecond" });
    expect(result.text).toContain("DRY RUN");
    expect(result.text).toContain("new file: 11 byte(s), 2 line(s)");
    expect(result.text).toContain("set execute=true");
    expect(fs.existsSync("notes/a.md")).toBe(false);
  });

  it("refuses to write without createDirs when the parent is missing", async () => {
    await expect(
      write().run({ path: "deep/nested/file.txt", content: "x", execute: true }),
    ).rejects.toThrow(/parent directory does not exist/);
  });

  it("execute creates parents with createDirs and writes the content", async () => {
    const result = await write().run({
      path: "deep/nested/file.txt",
      content: "hello\nworld",
      createDirs: true,
      execute: true,
    });
    expect(result.text).toContain("Wrote 11 byte(s)");
    expect(fs.readFileSync("deep/nested/file.txt", "utf8")).toBe("hello\nworld");
  });

  it("append mode adds to the end without clobbering", async () => {
    fs.writeFileSync("log.txt", "one\n", "utf8");
    await write().run({ path: "log.txt", content: "two\n", mode: "append", execute: true });
    expect(fs.readFileSync("log.txt", "utf8")).toBe("one\ntwo\n");
  });

  it("append to a missing file creates it", async () => {
    await write().run({ path: "new.txt", content: "x", mode: "append", execute: true });
    expect(fs.readFileSync("new.txt", "utf8")).toBe("x");
  });

  it("overwriting an existing file previews a diff stat", async () => {
    fs.writeFileSync("f.txt", "keep\n", "utf8");
    const result = await write().run({ path: "f.txt", content: "keep\nnew line\n" });
    expect(result.text).toContain("+1 / -0");
    expect(fs.readFileSync("f.txt", "utf8")).toBe("keep\n"); // untouched
  });

  it("refuses binary overwrite", async () => {
    fs.writeFileSync("img.bin", Buffer.from([0x00, 0x01, 0x02, 0x03]));
    await expect(write().run({ path: "img.bin", content: "text", execute: true })).rejects.toThrow(
      /binary file/,
    );
  });

  it("refuses directory targets", async () => {
    fs.mkdirSync("adir");
    await expect(write().run({ path: "adir", content: "x", execute: true })).rejects.toThrow(
      /directory/,
    );
  });

  it("enforces the 2MB content cap", async () => {
    await expect(
      write().run({ path: "big.txt", content: "x".repeat(2_000_001), execute: true }),
    ).rejects.toThrow(/2 MB|byte cap|exceeds/i);
  });

  it("rejects unknown modes", async () => {
    await expect(
      write().run({ path: "f.txt", content: "x", mode: "truncate-world", execute: true }),
    ).rejects.toThrow(/mode/);
  });
});

describe("write path containment helpers", () => {
  it("escapesWorkspace catches .. climbs and absolute escapes", () => {
    expect(escapesWorkspace("../outside", tmp)).toBe(true);
    expect(escapesWorkspace("/etc/passwd", tmp)).toBe(true);
    expect(escapesWorkspace("inside/f.txt", tmp)).toBe(false);
    expect(escapesWorkspace("./also-inside.txt", tmp)).toBe(false);
  });

  it("isSystemWritePath flags OS-managed locations only", () => {
    expect(isSystemWritePath("/etc/passwd", "linux")).toBe(true);
    expect(isSystemWritePath("/usr/local/bin/tool", "linux")).toBe(true);
    expect(isSystemWritePath("/etc", "linux")).toBe(true);
    expect(isSystemWritePath("C:\\Windows\\System32\\x.dll", "win32")).toBe(true);
    expect(isSystemWritePath("src/file.ts", "linux")).toBe(false);
    // Workspace-relative paths never trip the check even if a dir shares the name.
    expect(isSystemWritePath("etc/notes.txt", "linux")).toBe(false);
  });
});
