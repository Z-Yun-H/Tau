import { describe, expect, it } from "vitest";
import type { CommandInfo } from "../client/lib/api.js";
import { actionFor, clampIndex, filterCommands, menuOpenFor } from "../client/lib/slash.js";

/** Mirrors the server catalog (GET /api/commands → slashCommandsFor("webui")). */
const CATALOG: CommandInfo[] = [
  { name: "help", description: "show the command list" },
  { name: "skills", description: "list loaded skills" },
  { name: "history", description: "recent history entries" },
  { name: "status", description: "runtime locations and catalog sizes" },
  { name: "new", description: "start a new conversation" },
  { name: "theme", description: "cycle light / dark / system theme" },
  { name: "plan", description: "switch the composer to plan mode" },
  { name: "agent", description: "switch the composer to agent mode" },
  { name: "tools", description: "open the tools tab" },
  { name: "settings", description: "open the settings panel" },
];

describe("actionFor", () => {
  it("maps every webui catalog command to an action", () => {
    for (const command of CATALOG) {
      expect(actionFor(command.name), command.name).not.toBeNull();
    }
  });

  it("returns null for names without a webui action", () => {
    expect(actionFor("provider")).toBeNull();
    expect(actionFor("md")).toBeNull();
    expect(actionFor("")).toBeNull();
  });
});

describe("filterCommands", () => {
  it("shows everything for the bare slash", () => {
    expect(filterCommands(CATALOG, "/")).toHaveLength(CATALOG.length);
  });

  it("matches by prefix, case-insensitively", () => {
    const hits = filterCommands(CATALOG, "/TH");
    expect(hits.map((item) => item.name)).toEqual(["theme"]);
  });

  it("returns empty results for unknown prefixes", () => {
    expect(filterCommands(CATALOG, "/zz")).toEqual([]);
  });

  it("carries the resolved action on each menu item", () => {
    const hits = filterCommands(CATALOG, "/new");
    expect(hits).toEqual([{ name: "new", description: "start a new conversation", action: "new" }]);
  });

  it("drops entries without a webui action even if the server leaked them", () => {
    const leaked: CommandInfo[] = [{ name: "provider", description: "tui-only" }, ...CATALOG];
    const names = filterCommands(leaked, "/").map((entry: { name: string }) => entry.name);
    expect(names).not.toContain("provider");
  });
});

describe("menuOpenFor", () => {
  it("opens for a bare command token", () => {
    expect(menuOpenFor("/")).toBe(true);
    expect(menuOpenFor("/th")).toBe(true);
    expect(menuOpenFor("/THEME")).toBe(true);
  });

  it("stays closed for intents, spaces, and non-slash text", () => {
    expect(menuOpenFor("")).toBe(false);
    expect(menuOpenFor("/new thread")).toBe(false); // space → argument text
    expect(menuOpenFor("new")).toBe(false);
    expect(menuOpenFor("hello /")).toBe(false); // slash not at the start
  });
});

describe("clampIndex", () => {
  it("clamps into the valid range and handles empty lists", () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(3, 3)).toBe(2);
    expect(clampIndex(1, 0)).toBe(0);
  });
});
