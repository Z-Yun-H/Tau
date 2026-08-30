import * as readline from "node:readline";
import { theme } from "./theme.js";

export type ConfirmAnswer = "yes" | "all" | "skip" | "no";

/**
 * Interactive confirmation prompt.
 * Falls back to "no" when stdin is not a TTY (non-interactive environments).
 */
export function confirm(question: string): Promise<ConfirmAnswer> {
  if (!process.stdin.isTTY) {
    // Non-interactive: never auto-approve.
    return Promise.resolve("no");
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${theme.warn("?")} ${question} `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (["y", "yes"].includes(normalized)) return resolve("yes");
      if (["a", "all"].includes(normalized)) return resolve("all");
      if (["s", "skip"].includes(normalized)) return resolve("skip");
      return resolve("no");
    });
  });
}
