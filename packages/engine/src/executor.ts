/**
 * Plan-step executor — spawns tool handlers (or shell) with timeout and
 * output budgets, normalizes every failure into a StepOutcome so the session
 * loop can keep going and report honestly.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getTool } from "@tau/tools";
import { loadConfig } from "@tau/core";
import type { PlanStep, ShellPref, ToolResult } from "@tau/core";

export interface StepOutcome {
  ok: boolean;
  output: string;
  exitCode?: number;
  skipped?: boolean;
  /** True when this step was cut short by an abort signal (agent-loop cancel). */
  cancelled?: boolean;
}

export interface ExecutorOptions {
  timeoutSec: number;
  /** Called before each step; return false to skip the step. */
  gate?: (step: PlanStep, index: number) => Promise<boolean> | boolean;
  onOutput?: (chunk: string) => void;
  /** Shell for shell-steps (default: config `shell`, itself defaulting to "auto"). */
  shell?: ShellPref;
  /**
   * Optional cancellation signal (agent-loop Stop). Checked before each
   * step; while a shell step runs, an abort kills the child immediately.
   * Absent/never-aborted = zero behavior change.
   */
  signal?: AbortSignal;
}

/**
 * How a shell step will be spawned:
 * - `native`: `spawn(command, { shell: true })` — Node resolves the platform
 *   shell (POSIX /bin/sh; Windows COMSPEC/cmd.exe). The historical behavior,
 *   kept byte-identical for `auto` on POSIX.
 * - `argv`: explicit executable + args (pwsh/powershell/bash) — full control
 *   over flags, no cmd.exe quoting layer.
 */
export type ShellInvocation = { mode: "native" } | { mode: "argv"; file: string; args: string[] };

/**
 * Windows PATH probe for PowerShell executables (pure over platform+env —
 * tests inject a synthetic PATH; fs.existsSync treats any filename uniformly).
 * Returns the BEST available: pwsh (PowerShell 7+) preferred over powershell
 * (Windows PowerShell 5.1). Non-Windows platforms always return null.
 */
export function detectPwshWindows(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): "pwsh" | "powershell" | null {
  if (platform !== "win32") return null;
  const pathVar = env["PATH"] ?? "";
  for (const name of ["pwsh.exe", "powershell.exe"]) {
    for (const dir of pathVar.split(";")) {
      if (!dir.trim()) continue;
      try {
        // path.join keeps the function testable off-Windows (synthetic PATH
        // dirs) while producing correct backslash joins on real Windows.
        if (fs.existsSync(path.join(dir.trim(), name))) {
          return name === "pwsh.exe" ? "pwsh" : "powershell";
        }
      } catch {
        /* unreadable PATH entry — skip */
      }
    }
  }
  return null;
}

/**
 * Resolve how to spawn a shell step — PURE (no IO, no process state beyond
 * the injected defaults) so shell selection is testable and auditable.
 *
 * - `pwsh`/`powershell`: explicit argv — no profile, non-interactive, and a
 *   trailing exit-code propagation line (native commands set $LASTEXITCODE;
 *   cmdlet-only sequences fall back to exit 0; PS errors exit 1).
 * - `bash`: explicit `bash -c` (works everywhere bash exists).
 * - `auto`: POSIX stays `native` (zero change); Windows prefers a detected
 *   PowerShell and falls back to COMSPEC `native`.
 */
export function buildShellInvocation(
  command: string,
  pref: ShellPref,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): ShellInvocation {
  const platform = opts.platform ?? process.platform;
  const pwshArgs = (exe: string): ShellInvocation => ({
    mode: "argv",
    file: exe,
    // `?? 0` requires PS7; `-ne $null` works on 5.1 AND 7+ — use the portable form.
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `${command}\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`,
    ],
  });

  switch (pref) {
    case "pwsh":
      return pwshArgs("pwsh");
    case "powershell":
      return pwshArgs("powershell");
    case "bash":
      return platform === "win32"
        ? { mode: "native" } // no bash on stock Windows — defer to COMSPEC
        : { mode: "argv", file: "bash", args: ["-c", command] };
    case "auto":
    default: {
      if (platform === "win32") {
        const detected = detectPwshWindows(opts.env, platform);
        if (detected) return pwshArgs(detected);
      }
      return { mode: "native" };
    }
  }
}

export async function executeStep(
  step: PlanStep,
  index: number,
  options: ExecutorOptions,
): Promise<StepOutcome> {
  if (options.signal?.aborted) {
    return { ok: false, output: "(cancelled by user)", skipped: true, cancelled: true };
  }
  const allowed = options.gate ? await options.gate(step, index) : true;
  if (!allowed) {
    return { ok: true, output: "(skipped by user)", skipped: true };
  }

  if (step.kind === "tool") {
    const tool = step.tool ? getTool(step.tool) : undefined;
    if (!tool) {
      return { ok: false, output: `unknown tool: ${step.tool ?? "?"}`, exitCode: 1 };
    }
    try {
      const result: ToolResult = await tool.run(step.args ?? {});
      return { ok: true, output: result.text, exitCode: 0 };
    } catch (error) {
      return {
        ok: false,
        output: `tool ${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
      };
    }
  }

  // shell step — only ever reached after safety review + user confirmation.
  const command = (step.command ?? "").trim();
  if (!command) return { ok: false, output: "empty command", exitCode: 1 };
  return runShell(command, options);
}

export function runShell(command: string, options: ExecutorOptions): Promise<StepOutcome> {
  const pref = options.shell ?? loadConfig().shell ?? "auto";
  const invocation = buildShellInvocation(command, pref);
  // POSIX: spawn in its own process group so a kill takes the WHOLE tree
  // (shell + grandchildren like `sleep` that inherit the stdio pipes) — a
  // bare child.kill() orphans the pipes and the close event hangs until the
  // grandchildren exit naturally. Windows lacks process groups; the shell is
  // killed directly (COMSPEC/PowerShell propagate to children in practice).
  const posix = process.platform !== "win32";
  const child =
    invocation.mode === "native"
      ? spawn(command, {
          shell: true,
          cwd: process.cwd(),
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: posix,
        })
      : spawn(invocation.file, invocation.args, {
          shell: false,
          cwd: process.cwd(),
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: posix,
        });
  /** Kill the shell AND its process tree (group kill on POSIX). */
  const killTree = (): void => {
    try {
      if (posix && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      // Already gone — racy kills are expected (timeout vs close).
    }
  };
  return new Promise((resolve) => {
    let output = "";
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        killTree();
      }
    }, options.timeoutSec * 1000);

    // Agent-loop cancellation: an abort mid-run kills the tree at once;
    // the close handler below resolves with the cancelled outcome.
    const onAbort = (): void => {
      if (!finished) killTree();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const collect = (chunk: Buffer): void => {
      const text = chunk.toString();
      output += text;
      if (output.length > 200_000) {
        output = output.slice(0, 200_000) + "\n... (output truncated)";
        killTree();
      }
      options.onOutput?.(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ ok: false, output: `${output}\nspawn error: ${err.message}`, exitCode: -1 });
    });
    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      const killed = signal === "SIGKILL";
      const aborted = options.signal?.aborted === true;
      resolve({
        ok: code === 0,
        output: aborted
          ? `${output}\n(cancelled by user)`
          : killed
            ? `${output}\n(command timed out after ${options.timeoutSec}s)`
            : output.trimEnd(),
        exitCode: code ?? -1,
        ...(aborted ? { cancelled: true } : {}),
      });
    });
  });
}
