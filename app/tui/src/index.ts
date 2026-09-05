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
 * Slash commands are declared in @tau/agent's shared catalog
 * (slashCommandsFor("tui")) — the same metadata that drives /help drives
 * the command dispatch below and the "/" suggestion palette; execution
 * stays surface-local (handlers here, ANSI rendering here).
 *
 * Commands:
 *   /help      show this command list
 *   /provider  show the active provider, source, and model
 *   /skills    list loaded skills
 *   /history   show recent history entries
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
import { suggestFromList, theme, type ConfirmAnswer, type SuggestItem } from "@tau/ui";
import {
  detectGraphicsProtocol,
  metadataCard,
  readImage,
  renderImage,
  selectFromList,
} from "@tau/ui";
import { renderToAnsi, type AnsiTheme } from "@tau/markdown";
import {
  ensureCatalog,
  findSlashCommand,
  getActiveProvider,
  getSessionInfo,
  listModelCatalog,
  listSkillSummaries,
  parseSlashInvocation,
  planAndReview,
  ProviderUnavailableError,
  readRecentHistory,
  setProviderModel,
  slashCommandsFor,
  slashCommandUsage,
  thinkingState,
  updateThinking,
} from "@tau/agent";

const TUI_TIMEOUT_SEC = 120;
const MD_MAX_BYTES = 512 * 1024;

/**
 * Interactive-overlay seam for command handlers (issue #163): startTui
 * injects the single-reader-safe takeover (pause the session readline,
 * detach its keypress listeners, run on raw stdin, restore). When null —
 * tests, non-TTY runs — interactive pickers degrade to a listing that
 * never touches stdin, so the session can never hang.
 */
let overlayRunner: (<T>(fn: (stdin: NodeJS.ReadStream) => Promise<T>) => Promise<T>) | null = null;

/** Palette entries from the shared catalog — one item per TUI command. */
function suggestItems(): SuggestItem[] {
  return slashCommandsFor("tui").map((def) => ({
    value: slashCommandUsage(def) + (def.argsHint ? " " : ""),
    usage: slashCommandUsage(def),
    description: def.description,
  }));
}

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
 * /help output, generated from the shared command catalog so the listing can
 * never drift from what dispatch (and the "/" palette) actually accepts.
 */
function printHelp(): void {
  console.log(
    [
      theme.brand("commands"),
      ...slashCommandsFor("tui").map((def) =>
        theme.muted(`  ${slashCommandUsage(def).padEnd(13)}${def.description}`),
      ),
      theme.muted("  anything else is treated as a natural-language intent"),
    ].join("\n"),
  );
}

/**
 * One TUI command handler — receives everything after the command token.
 * Returns true when the session should end. Keyed by the catalog's primary
 * name (aliases resolve through findSlashCommand before lookup).
 */
type TuiCommandHandler = (arg: string) => Promise<boolean>;

const commandHandlers: Record<string, TuiCommandHandler> = {
  help: async () => {
    printHelp();
    return false;
  },
  exit: async () => true,
  clear: async () => {
    process.stdout.write("\x1b[2J\x1b[H");
    return false;
  },
  provider: async () => {
    const active = getActiveProvider();
    console.log(
      `${theme.brand(active.label)} ${theme.muted(`(${active.source}) — model: ${active.model}`)}`,
    );
    const state = thinkingState();
    console.log(theme.muted(`thinking: ${state.summary}`));
    return false;
  },
  model: async (arg) => {
    const target = arg.trim();
    const active = getActiveProvider();

    // Explicit model id — set directly, warn when unknown to the cache
    // (same semantics as `tau provider use <p> <model>`).
    if (target) {
      let known = false;
      try {
        const cache = await listModelCatalog(active.name, { offline: true });
        known = cache.models.some((model) => model.id === target);
      } catch {
        /* no cache — keep the set, the warning below explains */
      }
      setProviderModel(active.name, target);
      console.log(theme.ok(`Model set to "${target}".`));
      if (!known) {
        console.log(
          theme.muted(
            `"${target}" is not in the cached ${active.name} catalog — kept anyway (custom deployments are allowed).`,
          ),
        );
      }
      return false;
    }

    // No argument — pick from the catalog (fresh when possible, cached
    // when offline, honest when neither).
    try {
      const catalog = await withSpinner("refreshing model catalog…", () =>
        listModelCatalog(active.name),
      );
      if (catalog.warning) console.log(theme.warn(catalog.warning));
      if (catalog.source === "unsupported" || catalog.models.length === 0) {
        console.log(
          theme.muted(
            `No catalog available for "${active.name}" — set a model explicitly: /model <model-id>`,
          ),
        );
        return false;
      }
      if (!process.stdin.isTTY || !overlayRunner) {
        console.log(theme.muted(`Models for "${active.name}" (${catalog.source}):`));
        for (const model of catalog.models.slice(0, 15)) console.log(`  ${model.id}`);
        console.log(theme.muted("Non-interactive session — set one explicitly: /model <model-id>"));
        return false;
      }
      const current = active.model;
      const activeIndex = catalog.models.findIndex((model) => model.id === current);
      const picked = await overlayRunner((stdin) =>
        selectFromList({
          title: `Pick a model for "${active.name}" (enter selects, esc keeps "${current}"):`,
          items: catalog.models.map((model) =>
            model.ownedBy ? `${model.id} (${model.ownedBy})` : model.id,
          ),
          ...(activeIndex >= 0 ? { activeIndex } : {}),
          input: stdin,
        }),
      );
      const chosen = picked === null ? undefined : catalog.models[picked]?.id;
      if (picked === null || !chosen) {
        console.log(theme.muted(`Kept model "${current}".`));
        return false;
      }
      setProviderModel(active.name, chosen);
      console.log(theme.ok(`Model set to "${chosen}".`));
    } catch (error) {
      console.log(
        theme.error(
          `model catalog unavailable: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      console.log(theme.muted(`Inspect later with: tau provider models ${active.name}`));
    }
    return false;
  },
  thinking: async (arg) => {
    const parts = arg.split(/\s+/).filter(Boolean);
    const state = thinkingState();

    if (parts.length === 0) {
      console.log(`Thinking for "${state.provider}": ${state.summary}.`);
      const knobs = [
        state.capability.mode ? "on|off" : null,
        state.capability.effort ? "low|medium|high" : null,
      ].filter(Boolean);
      console.log(
        theme.muted(
          knobs.length > 0
            ? `Supported: ${knobs.join(", ")} — set with: /thinking ${knobs[0]}`
            : "This provider exposes no thinking knobs.",
        ),
      );
      return false;
    }

    const [mode, effort] = parts;
    if (mode !== "on" && mode !== "off") {
      console.log(theme.error(`thinking mode must be "on" or "off" (got "${mode}")`));
      console.log(theme.muted("usage: /thinking [on|off] [low|medium|high]"));
      return false;
    }
    if (effort !== undefined && !["low", "medium", "high"].includes(effort)) {
      console.log(theme.error(`thinking effort must be low, medium or high (got "${effort}")`));
      console.log(theme.muted("usage: /thinking [on|off] [low|medium|high]"));
      return false;
    }
    try {
      const next = updateThinking(state.provider, {
        mode,
        ...(effort !== undefined ? { effort: effort as "low" | "medium" | "high" } : {}),
      });
      console.log(theme.ok(`Thinking for "${state.provider}" set: ${next.summary}.`));
    } catch (error) {
      console.log(theme.error(error instanceof Error ? error.message : String(error)));
    }
    return false;
  },
  skills: async () => {
    const skills = listSkillSummaries();
    if (skills.length === 0) {
      console.log(theme.muted("no skills loaded"));
      return false;
    }
    for (const skill of skills) {
      console.log(`  ${theme.brand(skill.name)} ${theme.muted(`— ${skill.description}`)}`);
    }
    return false;
  },
  history: async () => {
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
  },
  status: async () => {
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
  },
  md: async (arg) => {
    const target = arg.trim();
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
  },
  view: async (arg) => {
    const target = arg.trim();
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
  },
};

/**
 * Handle one REPL line. Returns true when the session should end.
 *
 * `confirmFn` injects the session's own confirm reader (same prompt and
 * normalization as @tau/ui's confirm(), but riding THIS readline) — a second
 * readline interface over the same stdin would double-echo every keystroke
 * and leak the confirm answer back into the REPL as a phantom intent.
 *
 * Slash dispatch is registry-driven: the invocation is matched against
 * @tau/agent's shared catalog (aliases included); unknown or malformed
 * slash lines fall through to the intent pipeline, exactly as before the
 * registry existed. Exported for tests.
 */
export async function handleLine(
  raw: string,
  confirmFn: (question: string) => Promise<ConfirmAnswer>,
): Promise<boolean> {
  const line = raw.trim();
  if (!line) return false;

  if (line.startsWith("/")) {
    const invocation = parseSlashInvocation(line);
    if (invocation) {
      const def = findSlashCommand(invocation.name, "tui");
      const handler = def === undefined ? undefined : commandHandlers[def.name];
      if (handler !== undefined) {
        return await handler(invocation.args);
      }
    }
    // unknown or malformed slash command → natural-language intent below
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
    // Tab completion from the same catalog: one hit completes inline,
    // multiple hits render readline's native list on a second Tab.
    completer: (line: string): string[] => {
      if (!line.startsWith("/") || /\s/.test(line.slice(1))) return [];
      const partial = line.slice(1).toLowerCase();
      return slashCommandsFor("tui")
        .filter((def) => def.name.startsWith(partial))
        .map((def) => slashCommandUsage(def) + (def.argsHint ? " " : ""));
    },
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

  // ---- "/" suggestion palette (single-reader compatible) ----
  //
  // The palette rides THIS readline's already-raw stdin: on a "/" typed at
  // the start of an empty line (and only while the REPL is idle — no
  // pending confirm, no draining plan), we pause the interface, detach
  // readline's keypress listeners, hand stdin to the @tau/ui overlay, and
  // restore everything afterwards. No second reader is ever created, so
  // the guarantee above holds.
  let paletteOpen = false;

  /**
   * Single-reader-safe overlay takeover — the exact dance the palette
   * pioneered, extracted so command handlers (the /model picker, issue
   * #163) can run full-screen prompts mid-session without ever creating
   * a competing stdin reader.
   */
  const withOverlay = async <T>(fn: (stdin: NodeJS.ReadStream) => Promise<T>): Promise<T> => {
    const stdin = process.stdin;
    // readline attached its line-editing keypress listener to THIS stream;
    // detach it for the overlay's takeover, restore it afterwards.
    const saved = stdin.listeners("keypress");
    stdin.removeAllListeners("keypress");
    rl.pause();
    // rl.pause() pauses the underlying stream too — the overlay needs it
    // flowing (readline had it raw + flowing all along; restoring readline
    // below re-pauses nothing: rl.resume() resumes the stream itself).
    stdin.resume();
    try {
      return await fn(stdin);
    } finally {
      stdin.removeAllListeners("keypress");
      for (const listener of saved) stdin.addListener("keypress", listener);
      rl.resume();
    }
  };
  // Command handlers see the seam only inside a live session — imported
  // handleLine() in tests keeps the non-interactive degradation.
  overlayRunner = withOverlay;

  const openPalette = async (): Promise<void> => {
    const result = await withOverlay((stdin) =>
      suggestFromList({
        input: stdin,
        output: process.stdout,
        initialFilter: "/",
        items: suggestItems(),
        hint: "↑/↓ move · tab/enter insert · esc dismiss",
      }),
    );
    // Buffer sync happens AFTER resume — a paused interface may drop writes.
    if (result.action === "select" && result.value !== null) {
      // The buffer still holds the pre-palette "/"; append the rest.
      rl.write(result.value.slice(1));
    } else if (result.filter.length === 0) {
      // The user backspaced the "/" away — remove it from the buffer.
      rl.write("\b");
    } else {
      // Dismissed mid-filter — sync the buffer with what was typed.
      rl.write(result.filter.slice(1));
    }
  };

  process.stdin.on("keypress", (character) => {
    if (paletteOpen || answerSlot !== null || draining) return;
    if (character === "/" && rl.line === "/") {
      paletteOpen = true;
      void openPalette().finally(() => {
        paletteOpen = false;
      });
    }
  });

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
      // The session is over — command handlers drop back to the
      // non-interactive degradation (no session, no overlay).
      overlayRunner = null;
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
