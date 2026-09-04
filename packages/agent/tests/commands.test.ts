import { describe, expect, it } from "vitest";
import {
  findSlashCommand,
  parseSlashInvocation,
  slashCommandCatalog,
  slashCommandsFor,
  slashCommandUsage,
} from "../src/commands.js";

describe("slash command catalog integrity", () => {
  const catalog = slashCommandCatalog();

  it("has unique primary names", () => {
    const names = catalog.map((def) => def.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has aliases that never collide with any name or alias", () => {
    const names = new Set(catalog.map((def) => def.name));
    const aliases = catalog.flatMap((def) => def.aliases ?? []);
    expect(aliases.length).toBeGreaterThan(0); // exit/quit exists
    for (const alias of aliases) {
      expect(names.has(alias), `alias ${alias} collides with a command name`).toBe(false);
    }
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("always carries a non-empty description and consistent arg fields", () => {
    for (const def of catalog) {
      expect(def.description.trim().length).toBeGreaterThan(0);
      if (def.argsHint !== undefined) {
        expect(def.argsKind).toBeDefined();
        expect(def.argsKind).not.toBe("none");
      }
      if (def.surfaces !== undefined) {
        expect(def.surfaces.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the legacy TUI surface complete", () => {
    const tui = slashCommandsFor("tui").map((def) => def.name);
    for (const name of [
      "help",
      "provider",
      "skills",
      "history",
      "status",
      "md",
      "view",
      "clear",
      "exit",
    ]) {
      expect(tui).toContain(name);
    }
  });

  it("exposes webui-only commands to webui only", () => {
    const webui = slashCommandsFor("webui").map((def) => def.name);
    for (const name of ["new", "theme", "plan", "agent", "tools", "settings"]) {
      expect(webui).toContain(name);
    }
    expect(webui).not.toContain("provider");
    expect(webui).not.toContain("md");
    expect(slashCommandsFor("tui").map((def) => def.name)).not.toContain("theme");
  });
});

describe("findSlashCommand", () => {
  it("resolves primary names", () => {
    expect(findSlashCommand("help", "tui")?.name).toBe("help");
  });

  it("resolves aliases case-insensitively (quit → exit)", () => {
    expect(findSlashCommand("quit", "tui")?.name).toBe("exit");
    expect(findSlashCommand("QUIT", "tui")?.name).toBe("exit");
  });

  it("scopes lookups to the requested surface", () => {
    expect(findSlashCommand("theme", "tui")).toBeUndefined();
    expect(findSlashCommand("theme", "webui")?.name).toBe("theme");
    expect(findSlashCommand("md", "webui")).toBeUndefined();
  });

  it("searches the whole catalog when no surface is given", () => {
    expect(findSlashCommand("theme")?.name).toBe("theme");
    expect(findSlashCommand("md")?.name).toBe("md");
  });

  it("returns undefined for unknown tokens", () => {
    expect(findSlashCommand("nosuch", "tui")).toBeUndefined();
    expect(findSlashCommand("")).toBeUndefined();
  });
});

describe("parseSlashInvocation", () => {
  it("splits the first token from the remainder", () => {
    expect(parseSlashInvocation("/md a.md")).toEqual({ name: "md", args: "a.md" });
    expect(parseSlashInvocation("/md   spaced  path.md ")).toEqual({
      name: "md",
      args: "spaced  path.md",
    });
  });

  it("returns empty args for bare commands", () => {
    expect(parseSlashInvocation("/exit")).toEqual({ name: "exit", args: "" });
    expect(parseSlashInvocation("  /exit  ")).toEqual({ name: "exit", args: "" });
  });

  it("lowercases the command token", () => {
    expect(parseSlashInvocation("/EXIT")).toEqual({ name: "exit", args: "" });
  });

  it("rejects non-commands", () => {
    expect(parseSlashInvocation("hello world")).toBeNull();
    expect(parseSlashInvocation("")).toBeNull();
    expect(parseSlashInvocation("   ")).toBeNull();
    expect(parseSlashInvocation("/")).toBeNull();
    expect(parseSlashInvocation("/ ")).toBeNull();
  });
});

describe("slashCommandUsage", () => {
  it("appends the args hint", () => {
    const md = findSlashCommand("md", "tui");
    expect(md).toBeDefined();
    expect(slashCommandUsage(md!)).toBe("/md <file>");
    const exit = findSlashCommand("exit", "tui");
    expect(slashCommandUsage(exit!)).toBe("/exit");
  });
});
