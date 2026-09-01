/**
 * CLI end-to-end snapshots — the REAL binary entry spawned as a child
 * process (tsx + development conditions, exactly like `pnpm dev`), against a
 * TAU_HOME sandbox with the mock provider. Output is normalized (absolute
 * sandbox paths replaced) so the snapshots stay stable across machines;
 * anything dynamic (paths) is normalized, anything UX-visible is snapshotted.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-e2e-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(path.join(tmp, "home"), { recursive: true });
  process.chdir(tmp);
  // fixture tree for the file-find run
  fs.writeFileSync(path.join(tmp, "readme.md"), "# demo\n");
  fs.mkdirSync(path.join(tmp, "src"));
  fs.writeFileSync(path.join(tmp, "src", "main.ts"), "export const x = 1;\n");
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Spawn the real CLI entry; normalize sandbox paths in stdout/stderr. */
function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(process.execPath, ["--conditions=development", tsxCli, entry, ...args], {
    cwd: tmp,
    env: { ...process.env, TAU_HOME: path.join(tmp, "home") },
    encoding: "utf8",
    timeout: 60_000,
  });
  const normalize = (text: string): string =>
    text.replaceAll(tmp, "<sandbox>").replaceAll(os.tmpdir(), "<tmpdir>");
  return {
    stdout: normalize(res.stdout ?? ""),
    stderr: normalize(res.stderr ?? ""),
    status: res.status ?? -1,
  };
}

describe("CLI e2e — real process snapshots", () => {
  it("tau --version prints the workspace version", () => {
    const { stdout, status } = runCli(["--version"]);
    expect(status).toBe(0);
    // The release version changes over time — assert the shape, not the value.
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("tau --help renders the full command map", () => {
    const { stdout, status } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toMatchSnapshot();
  });

  it("tau file find lists matches from the working directory", () => {
    const { stdout, status } = runCli(["file", "find", "*.md", "-l", "5"]);
    expect(status).toBe(0);
    expect(stdout).toContain("readme.md");
    expect(stdout).toMatchSnapshot();
  });

  it("tau config round-trips the default shell key", () => {
    const set = runCli(["config", "set", "shell", "pwsh"]);
    expect(set.status).toBe(0);
    const get = runCli(["config", "get", "shell"]);
    expect(get.stdout.trim()).toBe("pwsh");
  });

  it("tau skill list works offline out of the box", () => {
    const { stdout, status } = runCli(["skill", "list"]);
    expect(status).toBe(0);
    expect(stdout).toContain("skill(s) available");
  });
});
