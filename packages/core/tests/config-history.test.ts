import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  saveConfig,
  getConfigValue,
  setConfigValue,
  DEFAULT_CONFIG,
} from "../src/config/store.js";
import {
  appendHistory,
  readHistory,
  findHistoryEntry,
  clearHistory,
} from "../src/config/history.js";
import { tauHome, configPath, historyPath } from "../src/config/paths.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-config-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("config store", () => {
  it("returns defaults when no config file exists", () => {
    const config = loadConfig();
    expect(config.provider).toBe(DEFAULT_CONFIG.provider);
    expect(config.timeout).toBe(DEFAULT_CONFIG.timeout);
  });

  it("round-trips save/load and merges defaults", () => {
    const config = loadConfig();
    config.provider = "ollama";
    saveConfig(config);
    expect(loadConfig().provider).toBe("ollama");
    expect(loadConfig().aliases).toBeDefined(); // default merged back
  });

  it("TAU_HOME redirect works", () => {
    expect(tauHome()).toBe(path.join(tmp, "home"));
    expect(configPath()).toBe(path.join(tmp, "home", "config.json"));
    expect(historyPath()).toBe(path.join(tmp, "home", "history.jsonl"));
  });

  it("get/set validates keys", () => {
    expect(getConfigValue("provider")).toBe("mock");
    setConfigValue("provider", "openai");
    expect(getConfigValue("provider")).toBe("openai");
    expect(() => getConfigValue("evil-key")).toThrow(/unknown config key/i);
  });

  it("coerces numbers and booleans", () => {
    setConfigValue("timeout", "60");
    expect(getConfigValue("timeout")).toBe(60);
    setConfigValue("allowMediumAutoApprove", "true");
    expect(getConfigValue("allowMediumAutoApprove")).toBe(true);
  });

  it("rejects invalid timeout", () => {
    expect(() => setConfigValue("timeout", "-5")).toThrow(/positive/i);
  });

  it("rejects object keys via set", () => {
    expect(() => setConfigValue("aliases", "{}")).toThrow(/object/i);
  });
});

describe("history store", () => {
  it("appends and reads newest-first", () => {
    appendHistory("first", "direct", [], "ok");
    appendHistory("second", "plan", [{ kind: "shell", command: "ls", reason: "r" }], "ok", {
      provider: "mock",
    });
    const entries = readHistory(10);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.input).toBe("second");
    expect(entries[0]?.provider).toBe("mock");
    expect(entries[1]?.input).toBe("first");
  });

  it("finds by id prefix", () => {
    const entry = appendHistory("findable", "direct", [], "ok");
    expect(findHistoryEntry(entry.id.slice(0, 3))?.input).toBe("findable");
    expect(findHistoryEntry("zzzz")).toBeUndefined();
  });

  it("survives corrupted lines", () => {
    fs.appendFileSync(historyPath(), "{not json\n");
    appendHistory("after-corruption", "direct", [], "ok");
    expect(readHistory(10)).toHaveLength(1);
  });

  it("clear removes all entries", () => {
    appendHistory("a", "direct", [], "ok");
    appendHistory("b", "direct", [], "ok");
    expect(clearHistory()).toBe(2);
    expect(readHistory(10)).toHaveLength(0);
  });
});
