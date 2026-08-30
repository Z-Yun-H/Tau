import { spawn } from "node:child_process";
import { getTool } from "../tools/registry.js";
import type { PlanStep, ToolResult } from "../types.js";

export interface StepOutcome {
  ok: boolean;
  output: string;
  exitCode?: number;
  skipped?: boolean;
}

export interface ExecutorOptions {
  timeoutSec: number;
  /** Called before each step; return false to skip the step. */
  gate?: (step: PlanStep, index: number) => Promise<boolean> | boolean;
  onOutput?: (chunk: string) => void;
}

export async function executeStep(
  step: PlanStep,
  index: number,
  options: ExecutorOptions,
): Promise<StepOutcome> {
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
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        child.kill("SIGKILL");
      }
    }, options.timeoutSec * 1000);

    const collect = (chunk: Buffer): void => {
      const text = chunk.toString();
      output += text;
      if (output.length > 200_000) {
        output = output.slice(0, 200_000) + "\n... (output truncated)";
        child.kill("SIGKILL");
      }
      options.onOutput?.(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: false, output: `${output}\nspawn error: ${err.message}`, exitCode: -1 });
    });
    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const killed = signal === "SIGKILL";
      resolve({
        ok: code === 0,
        output: killed
          ? `${output}\n(command timed out after ${options.timeoutSec}s)`
          : output.trimEnd(),
        exitCode: code ?? -1,
      });
    });
  });
}
