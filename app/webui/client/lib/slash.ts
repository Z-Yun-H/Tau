/**
 * Composer slash-menu logic — pure functions, no DOM, no Vue.
 *
 * Command METADATA comes from the server (`GET /api/commands` →
 * @tau/agent's shared catalog, webui surface — the same vocabulary the TUI
 * palette reads). Command ACTIONS are webui-local: this file maps a command
 * name to what the app shell should do. Execution stays client-side by
 * contract — a slash command never sends an intent to the AI.
 */

import type { CommandInfo } from "./api.js";

/** What the app shell does when a slash command is picked. */
export type SlashActionId =
  | "new"
  | "theme"
  | "plan"
  | "agent"
  | "tools"
  | "settings"
  | "help"
  | "status"
  | "skills"
  | "history";

const ACTIONS: Record<string, SlashActionId> = {
  new: "new",
  theme: "theme",
  plan: "plan",
  agent: "agent",
  tools: "tools",
  settings: "settings",
  help: "help",
  status: "status",
  skills: "skills",
  history: "history",
};

export function actionFor(name: string): SlashActionId | null {
  return ACTIONS[name] ?? null;
}

export interface SlashMenuItem {
  name: string;
  description: string;
  action: SlashActionId;
}

/**
 * Filter catalog entries for the menu: the query is the composer text
 * (e.g. "/" or "/th"); commands match by name prefix, case-insensitive,
 * catalog order preserved, and only commands with a webui action appear.
 */
export function filterCommands(commands: CommandInfo[], query: string): SlashMenuItem[] {
  const partial = query.startsWith("/") ? query.slice(1).toLowerCase() : query.toLowerCase();
  return commands
    .filter((command) => command.name.startsWith(partial))
    .filter((command) => actionFor(command.name) !== null)
    .map((command) => ({
      name: command.name,
      description: command.description,
      action: actionFor(command.name) as SlashActionId,
    }));
}

/**
 * True when the composer text is a bare command token (`/`, `/th`, …) —
 * the menu shows while no argument text has started. Webui commands take
 * no arguments, so the menu hides as soon as a space is typed.
 */
export function menuOpenFor(text: string): boolean {
  return /^\/\S*$/.test(text);
}

/** Clamp helper shared by the menu navigation. */
export function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  if (index < 0) return 0;
  if (index > length - 1) return length - 1;
  return index;
}
