/**
 * tau history — browse, show, replay and clear the JSONL run history.
 * Replay re-executes a stored plan through runPlan so it passes the same
 * review/confirm gates as the original run.
 */

import type { Command } from "commander";
import { theme } from "../ui/theme.js";
import { clearHistory, findHistoryEntry, readHistory } from "../config/history.js";
import { runPlan } from "../core/session.js";
import { globalOptions, timeoutSec } from "./util.js";
import { loadConfig } from "../config/store.js";

export function registerHistoryCommands(program: Command): void {
  const history = program
    .command("history")
    .description("Inspect and replay what Tau ran (JSONL store under TAU_HOME)");

  history
    .command("list")
    .description("Show recent entries (newest first)")
    .option("-n, --limit <n>", "how many", "20")
    .option("--json", "machine-readable output")
    .action((opts) => {
      const entries = readHistory(Number(opts.limit) || 20);
      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      if (entries.length === 0) {
        console.log(theme.muted("(history is empty)"));
        return;
      }
      for (const entry of entries) {
        const statusColor =
          entry.status === "ok"
            ? theme.ok(entry.status)
            : entry.status === "failed"
              ? theme.error(entry.status)
              : theme.warn(entry.status);
        console.log(
          `${theme.muted(entry.id)}  ${entry.ts.slice(0, 19).replace("T", " ")}  ${statusColor.padEnd(9)}  ${entry.input.slice(0, 70)}`,
        );
      }
    });

  history
    .command("show")
    .description("Show the full plan of one entry")
    .argument("<id>", "entry id (prefix allowed)")
    .action((id: string) => {
      const entry = findHistoryEntry(id);
      if (!entry) {
        console.error(theme.error(`No history entry matching "${id}"`));
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(entry, null, 2));
    });

  history
    .command("replay")
    .description("Re-run an entry's plan (goes through safety review + confirm again)")
    .argument("<id>", "entry id (prefix allowed)")
    .action(async (id, _opts, command) => {
      const entry = findHistoryEntry(id);
      if (!entry) {
        console.error(theme.error(`No history entry matching "${id}"`));
        process.exitCode = 1;
        return;
      }
      const globals = globalOptions(command);
      const config = loadConfig();
      const result = await runPlan(
        `replay:${entry.id}`,
        { explanation: `Replay of ${entry.input}`, steps: entry.steps },
        {
          provider: entry.provider,
          assumeYes: globals.yes,
          allowMediumAutoApprove: config.allowMediumAutoApprove,
          timeoutSec: timeoutSec(),
        },
      );
      if (result.status !== "ok") process.exitCode = result.status === "denied" ? 2 : 1;
    });

  history
    .command("clear")
    .description("Delete the history file")
    .action(() => {
      const removed = clearHistory();
      console.log(theme.ok(`Cleared ${removed} entr${removed === 1 ? "y" : "ies"}.`));
    });
}
