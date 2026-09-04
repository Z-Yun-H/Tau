/**
 * UI-agnostic slash-command registry — the shared vocabulary of session
 * commands that interactive front doors (TUI REPL, WebUI composer) present
 * and dispatch.
 *
 * Pure data by contract: definitions carry names, aliases, descriptions and
 * argument hints — never execution semantics. Execution stays surface-local
 * (the TUI maps a command to session services + ANSI output, the WebUI maps
 * it to its own client actions/endpoints), so this module imports nothing
 * and every front door can render the same command the same way.
 *
 * Lives in `@tau/agent` beside `session.ts` — the module that is already
 * "the single source of the facts and flows that both interactive front
 * doors present and drive" — because the commands described here resolve to
 * exactly those services (provider, skills, history, session info). Both
 * apps already depend on `@tau/agent`, so no new dependency edge is created.
 */

/** Front doors that can expose slash commands. */
export type SlashSurface = "tui" | "webui";

export interface SlashCommandDef {
  /** Primary name WITHOUT the leading slash, e.g. "help". */
  name: string;
  /** Alternative names dispatching to the same command, e.g. ["quit"]. */
  aliases?: string[];
  /** One-line description shown in menus, palettes and help output. */
  description: string;
  /** Argument hint, e.g. "<file>" — omit for no-argument commands. */
  argsHint?: string;
  /** What kind of argument the command takes (drives future completion). */
  argsKind?: "none" | "file" | "free";
  /** Front doors that expose the command; omit = every surface. */
  surfaces?: SlashSurface[];
}

const CATALOG: readonly SlashCommandDef[] = [
  {
    name: "help",
    description: "show the command list",
    surfaces: ["tui", "webui"],
  },
  {
    name: "provider",
    description: "active provider, source, and model",
    surfaces: ["tui"],
  },
  {
    name: "skills",
    description: "list loaded skills",
    surfaces: ["tui", "webui"],
  },
  {
    name: "history",
    description: "recent history entries",
    surfaces: ["tui", "webui"],
  },
  {
    name: "status",
    description: "runtime locations and catalog sizes",
    surfaces: ["tui", "webui"],
  },
  {
    name: "md",
    argsHint: "<file>",
    argsKind: "file",
    description: "preview a markdown file (ANSI-rendered)",
    surfaces: ["tui"],
  },
  {
    name: "view",
    argsHint: "<file>",
    argsKind: "file",
    description: "preview an image (inline image or metadata card)",
    surfaces: ["tui"],
  },
  {
    name: "clear",
    description: "clear the screen",
    surfaces: ["tui"],
  },
  {
    name: "exit",
    aliases: ["quit"],
    description: "leave the session",
    surfaces: ["tui"],
  },
  // ---- WebUI-surface commands (consumed by the composer slash menu) ----
  {
    name: "new",
    description: "start a new conversation",
    surfaces: ["webui"],
  },
  {
    name: "theme",
    description: "cycle light / dark / system theme",
    surfaces: ["webui"],
  },
  {
    name: "plan",
    description: "switch the composer to plan mode",
    surfaces: ["webui"],
  },
  {
    name: "agent",
    description: "switch the composer to agent mode",
    surfaces: ["webui"],
  },
  {
    name: "tools",
    description: "open the tools tab",
    surfaces: ["webui"],
  },
  {
    name: "settings",
    description: "open the settings panel",
    surfaces: ["webui"],
  },
];

/** The full command catalog (all surfaces). Ordered for menu display. */
export function slashCommandCatalog(): readonly SlashCommandDef[] {
  return CATALOG;
}

/** Commands visible on one surface, in catalog order. */
export function slashCommandsFor(surface: SlashSurface): SlashCommandDef[] {
  return CATALOG.filter((def) => def.surfaces === undefined || def.surfaces.includes(surface));
}

/**
 * Resolve a command token (WITHOUT the leading slash) to its definition,
 * honoring aliases. `surface` scopes the lookup to what that front door
 * exposes; omit it to search the whole catalog.
 */
export function findSlashCommand(
  token: string,
  surface?: SlashSurface,
): SlashCommandDef | undefined {
  const needle = token.toLowerCase();
  const pool = surface === undefined ? CATALOG : slashCommandsFor(surface);
  return pool.find((def) => def.name === needle || def.aliases?.includes(needle));
}

/**
 * Parse one REPL/composer line into a slash invocation.
 * Returns null when the line is not a slash command (natural-language
 * intent, empty, or a bare "/" with no name). Leading/trailing whitespace
 * is tolerated; only the FIRST token is the command, the rest is args.
 */
export function parseSlashInvocation(line: string): { name: string; args: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/") || trimmed.length < 2) return null;
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (match === null) return null;
  const name = (match[1] ?? "").toLowerCase();
  if (!name) return null;
  return { name, args: (match[2] ?? "").trim() };
}

/** Display form, e.g. "/md <file>" — used by help output and menus. */
export function slashCommandUsage(def: SlashCommandDef): string {
  return `/${def.name}${def.argsHint ? ` ${def.argsHint}` : ""}`;
}
