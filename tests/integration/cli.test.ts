import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main, buildProgram } from "../../src/index.js";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_ARGV = process.argv;
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-cli-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(path.join(tmp, "home"), { recursive: true });
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  process.argv = ORIGINAL_ARGV;
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<void> {
  process.argv = ["node", "tau", ...args];
  await main(process.argv);
}

describe("CLI integration (in-process)", () => {
  it("--help lists all command families", async () => {
    const program = buildProgram();
    const help = program.helpInformation();
    for (const family of [
      "ask",
      "file",
      "sys",
      "net",
      "text",
      "skill",
      "history",
      "alias",
      "config",
    ]) {
      expect(help).toContain(family);
    }
  });

  it("file find runs and prints matches", async () => {
    fs.writeFileSync("needle.txt", "x");
    await run("file", "find", "*.txt");
    // No exit code set => success.
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("sys info prints a summary", async () => {
    await run("sys", "info");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("skill list shows bundled skills", async () => {
    await run("skill", "list");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("skill validate exits non-zero for unknown skill", async () => {
    await run("skill", "validate", "does-not-exist");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("tau ask end-to-end with mock provider and --yes", async () => {
    fs.writeFileSync("hello.ts", "export const x = 1;");
    await run("ask", "查找所有 ts 文件", "--provider", "mock", "--yes");
    expect(process.exitCode ?? 0).toBe(0);
    // History recorded the plan run.
    const history = fs.readFileSync(path.join(tmp, "home", "history.jsonl"), "utf8");
    expect(history).toContain('"kind":"plan"');
    expect(history).toContain("mock");
  });

  it("tau ask --explain prints the planner prompt", async () => {
    await run("ask", "anything", "--provider", "mock", "--explain");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("config set/get round-trips", async () => {
    await run("config", "set", "provider", "openai");
    await run("config", "get", "provider");
    const config = JSON.parse(fs.readFileSync(path.join(tmp, "home", "config.json"), "utf8")) as {
      provider: string;
    };
    expect(config.provider).toBe("openai");
  });

  it("config path prints TAU_HOME location", async () => {
    await run("config", "path");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("alias add + expansion flows through main()", async () => {
    fs.writeFileSync("alpha.txt", "x");
    await run("alias", "add", "findtxt", "file", "find", "*.txt");
    await run("findtxt");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("history list / clear work", async () => {
    await run("file", "find", "*.txt"); // produces a direct entry
    await run("history", "list");
    await run("history", "clear");
    expect(fs.existsSync(path.join(tmp, "home", "history.jsonl"))).toBe(false);
  });

  it("global options are accepted before or after the subcommand", async () => {
    fs.writeFileSync("beta.txt", "x");
    await run("--provider", "mock", "--yes", "ask", "find files"); // before
    await run("ask", "find files", "--provider", "mock", "--yes"); // after
    expect(process.exitCode ?? 0).toBe(0);
  });
});
