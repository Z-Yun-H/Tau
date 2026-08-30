/**
 * Alias expansion tests — moved here from the config suite because aliases
 * are a CLI-layer concern (argv rewriting happens before commander parses).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, saveConfig, tauHome } from "@tau/core";
import { expandAliasArgv } from "../src/cli/alias.js";

let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-alias-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
});

afterEach(() => {
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("alias expansion", () => {
  it("expands the first token before commander parses", () => {
    const config = loadConfig();
    config.aliases["ll"] = ["file", "find", "*.ts"];
    saveConfig(config);

    const expanded = expandAliasArgv(["node", "tau", "ll", "-p", "src"]);
    expect(expanded).toEqual(["node", "tau", "file", "find", "*.ts", "-p", "src"]);
  });

  it("leaves argv untouched without a matching alias", () => {
    const argv = ["node", "tau", "sys", "info"];
    expect(expandAliasArgv(argv)).toEqual(argv);
  });

  it("empty argv passes through", () => {
    expect(expandAliasArgv(["node", "tau"])).toEqual(["node", "tau"]);
  });
});
