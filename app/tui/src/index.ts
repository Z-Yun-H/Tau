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
 *   /md <file>     preview a markdown file (ANSI-rendered headings, code, tables)
 *   /view <file>   preview an image (Kitty/iTerm2 inline image; metadata card fallback)
 *   /clear     clear the screen
 *   /exit      leave the session (also /quit, Ctrl+D)
 *
 * (Line 1 is the #!/usr/bin/env node shebang; tsdown preserves it in the
 * bundle and marks the output executable.)
 */

import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { loadConfig } from "@tau/core";
import { renderPlan, renderReview, runPlan } from "@tau/engine";
import { theme, type ConfirmAnswer } from "@tau/ui";
import { detectGraphicsProtocol, metadataCard, readImage, renderImage } from "@tau/ui";
import { renderToAnsi, type AnsiTheme } from "@tau/markdown";
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
const MD_MAX_BYTES = 512 * 1024;

/** Terminal markdown styling bound to the shared tau theme. */
const markdownTheme: AnsiTheme = {
  heading: (text, level) =>
    level <= 1 ? theme.title(text) : level === 2 ? theme.brand(text) : theme.bold(text),
  strong: theme.bold,
  em: (text) => text,
  codespan: theme.warn,
  del: theme.muted,
  link: (text, href) => `${theme.brand(text)} ${theme.muted(`(${href})`)}`,
  codeBlock: theme.info,
  codeRule: theme.muted,
  quote: theme.muted,
  bullet: theme.brand,
  hr: theme.muted,
  tableBorder: theme.muted,
  muted: theme.muted,
};

const renderMd = (md: string): string => renderToAnsi(md, { theme: markdownTheme, width: 88 });

/** Read a text file for /md; refuses binaries and oversized files. */
async function readMarkdownFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  if (buffer.byteLength > MD_MAX_BYTES) {
    throw new Error(`markdown file larger than ${Math.round(MD_MAX_BYTES / 1024)} KB`);
  }
  const head = buffer.subarray(0, 8192);
  if (head.includes(0)) {
    throw new Error("refusing to render a binary file as markdown");
  }
  return buffer.toString("utf8");
}

/**
 * Readline-aware spinner — frames replace the prompt line while an async
 * step runs; cleared on completion. Silent when stdout is not a TTY.
 */
async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frame = 0;
  const timer =
    process.stdout.isTTY === true
      ? setInterval(() => {
          process.stdout.write(`\r${theme.muted(frames[frame++ % frames.length] + " " + label)}`);
        }, 80)
      : null;
  try {
    return await fn();
  } finally {
    if (timer) {
      clearInterval(timer);
      process.stdout.write("\r\x1b[K");
    }
  }
}

/**
 * Handle one REPL line. Returns true when the session should end.
 *
 * `confirmFn` injects the session's own confirm reader (same prompt and
 * normalization as @tau/ui's confirm(), but riding THIS readline) — a second
 * readline interface over the same stdin would double-echo every keystroke
 * and leak the confirm answer back into the REPL as a phantom intent.
 */
async function handleLine(
  raw: string,
  confirmFn: (question: string) => Promise<ConfirmAnswer>,
): Promise<boolean> {
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
          theme.muted("  /md <file>  preview a markdown file (ANSI-rendered)"),
          theme.muted("  /view <file>  preview an image (inline image or metadata card)"),
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
    case "/md": {
      const target = line.slice(3).trim();
      if (!target) {
        console.log(theme.muted("usage: /md <file>"));
        return false;
      }
      try {
        console.log(renderMd(await readMarkdownFile(target)));
      } catch (error) {
        console.log(theme.error(`cannot preview: ${(error as Error).message}`));
      }
      return false;
    }
    case "/view": {
      const target = line.slice(5).trim();
      if (!target) {
        console.log(theme.muted("usage: /view <file>"));
        return false;
      }
      try {
        const buffer = await readFile(target);
        const meta = await readImage(target);
        console.log(await renderImage(meta, buffer, detectGraphicsProtocol()));
      } catch (error) {
        console.log(theme.error(`cannot view: ${(error as Error).message}`));
        if (!(error instanceof Error && error.message.startsWith("image larger"))) {
          console.log(theme.muted(metadataCard({ path: target, format: "?", bytes: 0 })));
        }
      }
      return false;
    }
    default:
      break;
  }

  // ---- intent pipeline (same sequence as `tau ask`) ----
  try {
    const planned = await withSpinner("planning…", () => planAndReview(line));
    for (const warning of planned.warnings) {
      console.log(theme.warn(`plugin: ${warning}`));
    }
    console.log(
      theme.muted(
        `planning with ${planned.providerLabel} (${planned.providerSource}) — risk gate is independent of the AI`,
      ),
    );
    console.log(renderPlan(planned.plan, planned.review.overallRisk, { explanation: renderMd }));
    const reviewText = renderReview(planned.plan);
    if (reviewText) console.log(reviewText);
    if (planned.review.verdict === "deny") {
      console.log(theme.error("Plan denied by safety review — nothing ran."));
      return false;
    }
    const answer = await confirmFn("Run this plan? [y]es / [a]ll steps / [n]o");
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

  // Single-reader session: every completed line goes to exactly ONE reader —
  // the open confirm prompt (answerSlot) when one is pending, the REPL queue
  // otherwise. readline interfaces do not pause stdin between each other, so
  // a second interface here would double-echo every keystroke and queue the
  // confirm answer into the REPL as a phantom intent (seen in real pty
  // captures: "yy" echoes, then the mock provider plans an intent "y").
  let answerSlot: ((line: string) => void) | null = null;
  const queue: string[] = [];
  let draining = false;

  /** Confirm on the session readline — same prompt and answer normalization
   * as @tau/ui's confirm(), minus the competing interface. */
  const confirmInSession = (question: string): Promise<ConfirmAnswer> =>
    new Promise((resolve) => {
      answerSlot = (line) => {
        const normalized = line.trim().toLowerCase();
        if (["y", "yes"].includes(normalized)) resolve("yes");
        else if (["a", "all"].includes(normalized)) resolve("all");
        else if (["s", "skip"].includes(normalized)) resolve("skip");
        else resolve("no");
      };
      process.stdout.write(`${theme.warn("?")} ${question} `);
    });

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        const line = queue.shift() ?? "";
        const stop = await handleLine(line, confirmInSession);
        if (stop) {
          rl.close();
          return;
        }
        rl.prompt();
      }
    } finally {
      draining = false;
    }
  };

  rl.on("line", (line) => {
    if (answerSlot) {
      const settle = answerSlot;
      answerSlot = null;
      settle(line);
      return;
    }
    queue.push(line);
    void drain().catch((error) => {
      rl.close();
      console.error((error as Error).message);
      process.exitCode = 1;
    });
  });

  rl.prompt();
  return new Promise((resolve) => {
    rl.on("close", () => {
      // EOF / Ctrl+D while a confirm is open — settle as "no", never approve.
      if (answerSlot) {
        const settle = answerSlot;
        answerSlot = null;
        settle("");
      }
      resolve();
    });
  });
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
