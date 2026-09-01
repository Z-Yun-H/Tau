#!/usr/bin/env node
/**
 * Tau TUI — interactive terminal session (REPL).
 *
 * A conversational shell on top of the exact same pipeline as `tau ask`:
 * every free-form line is an intent that goes plan -> review -> confirm ->
 * runPlan. Slash commands manage providers, skills, and history without
 * leaving the session. The safety gate is identical to the CLI — the TUI is
 * only a different front door into @tau/agent + @tau/engine.
 *
 * Commands:
 *   /help      show this command list
 *   /provider  show the active provider, source, and model
 *   /skills    list loaded skills
 *   /history   show the last 10 history entries
 *   /status    show runtime locations and catalog sizes
 *   /clear     clear the screen
 *   /exit      leave the session (also /quit, Ctrl+D)
 *
 * (Line 1 is the #!/usr/bin/env node shebang; tsdown preserves it in the
 * bundle and marks the output executable.)
 */

import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { loadConfig } from "@tau/core";
import { renderPlan, renderReview, runPlan } from "@tau/engine";
import { confirm, theme } from "@tau/ui";
import {
  ensureCatalog,
  getActiveProvider,
  getSessionInfo,
  listSkillSummaries,
  planAndReview,
  ProviderUnavailableError,
  readRecentHistory,
} from "@tau/agent";

const TUI_TIMEOUT_SEC = 120;

/** Handle one REPL line. Returns true when the session should end. */
async function handleLine(raw: string): Promise<boolean> {
  const line = raw.trim();
  if (!line) return false;
  const command = line.split(/\s+/)[0] ?? "";

  switch (command) {
    case "/help": {
      console.log(
        [
          theme.brand("commands"),
          theme.muted("  /provider   active provider, source, and model"),
          theme.muted("  /skills     list loaded skills"),
          theme.muted("  /history    last 10 history entries"),
          theme.muted("  /status     runtime locations and catalog sizes"),
          theme.muted("  /clear      clear the screen"),
          theme.muted("  /exit       leave the session (also /quit)"),
          theme.muted("  anything else is treated as a natural-language intent"),
        ].join("\n"),
      );
      return false;
    }
    case "/exit":
    case "/quit":
      return true;
    case "/clear":
      process.stdout.write("\x1b[2J\x1b[H");
      return false;
    case "/provider": {
      const active = getActiveProvider();
      console.log(
        `${theme.brand(active.label)} ${theme.muted(`(${active.source}) — model: ${active.model}`)}`,
      );
      return false;
    }
    case "/skills": {
      const skills = listSkillSummaries();
      if (skills.length === 0) {
        console.log(theme.muted("no skills loaded"));
        return false;
      }
      for (const skill of skills) {
        console.log(`  ${theme.brand(skill.name)} ${theme.muted(`— ${skill.description}`)}`);
      }
      return false;
    }
    case "/history": {
      const entries = readRecentHistory(10);
      if (entries.length === 0) {
        console.log(theme.muted("history is empty"));
        return false;
      }
      for (const entry of entries) {
        console.log(
          `  ${theme.risk(entry.status === "ok" ? "low" : "high")} ${theme.muted(`[${entry.kind}]`)} ${entry.input}`,
        );
      }
      return false;
    }
    case "/status": {
      const info = await getSessionInfo();
      console.log(
        [
          `  ${theme.muted("home:")} ${info.tauHome}`,
          `  ${theme.muted("provider:")} ${info.provider.name} ${theme.muted(`— model: ${info.provider.model}`)}`,
          `  ${theme.muted("skills:")} ${info.skillsCount}`,
          `  ${theme.muted("plugins:")} ${info.pluginsCount}`,
          `  ${theme.muted("providers:")} ${info.providers.length} registered`,
        ].join("\n"),
      );
      return false;
    }
    default:
      break;
  }

  // ---- intent pipeline (same sequence as `tau ask`) ----
  try {
    const planned = await planAndReview(line);
    for (const warning of planned.warnings) {
      console.log(theme.warn(`plugin: ${warning}`));
    }
    console.log(
      theme.muted(
        `planning with ${planned.providerLabel} (${planned.providerSource}) — risk gate is independent of the AI`,
      ),
    );
    console.log(renderPlan(planned.plan, planned.review.overallRisk));
    const reviewText = renderReview(planned.plan);
    if (reviewText) console.log(reviewText);
    if (planned.review.verdict === "deny") {
      console.log(theme.error("Plan denied by safety review — nothing ran."));
      return false;
    }
    const answer = await confirm("Run this plan? [y]es / [a]ll steps / [n]o");
    if (answer === "no") {
      console.log(theme.muted("(cancelled)"));
      return false;
    }
    // The user explicitly approved above; runPlan still re-reviews the plan
    // and its deny verdict is enforced inside the engine.
    const result = await runPlan(line, planned.plan, {
      provider: planned.providerName,
      assumeYes: false,
      allowMediumAutoApprove: loadConfig().allowMediumAutoApprove,
      timeoutSec: TUI_TIMEOUT_SEC,
      autoApproveAll: true,
    });
    if (result.status !== "ok") {
      console.log(theme.error(`Plan ${result.status}.`));
    }
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      console.log(theme.error(error.message));
      console.log(
        theme.muted(
          "Tip: `tau provider set-key <provider>` then `tau provider use <provider>`, or stay offline with `tau config set provider mock`.",
        ),
      );
    } else {
      console.log(
        theme.error(`planning failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
  }
  return false;
}

/** Start the interactive session. Requires a TTY (reads keys line by line). */
export async function startTui(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("tau tui needs an interactive terminal (TTY).");
    process.exitCode = 1;
    return;
  }
  ensureCatalog();
  console.log(
    [
      theme.brand("τ tau tui") + theme.muted(" — interactive session"),
      theme.muted("type an intent, or /help for commands. Ctrl+D exits."),
    ].join("\n"),
  );
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: theme.brand("tau ❯ "),
  });
  rl.prompt();
  for await (const line of rl) {
    const stop = await handleLine(line);
    if (stop) break;
    rl.prompt();
  }
  rl.close();
}

/**
 * CLI wiring note: `tau tui` is registered by @tau/cli with a LAZY dynamic
 * import of startTui — this package stays commander-free and loads only when
 * the interactive session actually starts.
 */

// Only auto-run when executed directly (not when imported by the CLI/tests).
// Installed bins run through a symlink (npm/pnpm .bin, `pnpm link`), so
// argv[1] must be resolved to its realpath before comparing against
// import.meta.url (Node ESM reports this module under its real path).
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  startTui().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
