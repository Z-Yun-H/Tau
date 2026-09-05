import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureCatalog } from "@tau/agent";
import { loadConfig, setConfigValue, updateProviderEntry } from "@tau/core";
import { handleLine } from "../src/index.js";

/**
 * Registry-driven slash dispatch equivalence tests for the TUI.
 * handleLine is the exported REPL entry; commands never touch confirmFn,
 * so a rejecting confirm stub doubles as an "unexpected confirm" tripwire
 * for the pure-command cases.
 */

const neverConfirm = async (): Promise<"no"> => {
  throw new Error("confirmFn must not be called for slash commands");
};

let tauHome = "";

beforeEach(() => {
  tauHome = mkdtempSync(join(tmpdir(), "tau-tui-commands-"));
  process.env.TAU_HOME = tauHome;
  ensureCatalog();
});

afterEach(() => {
  delete process.env.TAU_HOME;
  rmSync(tauHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("tui slash dispatch (registry-driven)", () => {
  it("ends the session on /exit and the /quit alias", async () => {
    await expect(handleLine("/exit", neverConfirm)).resolves.toBe(true);
    await expect(handleLine("/quit", neverConfirm)).resolves.toBe(true);
    await expect(handleLine("  /QUIT  ", neverConfirm)).resolves.toBe(true);
  });

  it("generates /help from the shared catalog", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(handleLine("/help", neverConfirm)).resolves.toBe(false);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    for (const usage of [
      "/provider",
      "/skills",
      "/history",
      "/status",
      "/md <file>",
      "/view <file>",
      "/clear",
      "/exit",
    ]) {
      expect(output).toContain(usage);
    }
    expect(output).toContain("anything else is treated as a natural-language intent");
    // /quit is an alias — the listing shows primary names only
    expect(output).not.toMatch(/\/quit\s/);
  });

  it("clears the screen on /clear", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(handleLine("/clear", neverConfirm)).resolves.toBe(false);
    expect(write).toHaveBeenCalledWith("\x1b[2J\x1b[H");
  });

  it("prints the active provider on /provider", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(handleLine("/provider", neverConfirm)).resolves.toBe(false);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toMatch(/mock/i);
    expect(output).toContain("model:");
  });

  it("reports empty history on /history in a fresh TAU_HOME", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(handleLine("/history", neverConfirm)).resolves.toBe(false);
    expect(log.mock.calls.some((call) => String(call[0]).includes("history is empty"))).toBe(true);
  });

  it("prints session info on /status", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(handleLine("/status", neverConfirm)).resolves.toBe(false);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("home:");
    expect(output).toContain("providers:");
  });

  it("prints usage when /md or /view lack an argument", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/md", neverConfirm);
    await handleLine("/view", neverConfirm);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("usage: /md <file>");
    expect(output).toContain("usage: /view <file>");
  });

  it("renders a markdown file on /md <file>", async () => {
    const file = join(tauHome, "sample.md");
    writeFileSync(file, "# Heading One\n\nbody text\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(handleLine(`/md ${file}`, neverConfirm)).resolves.toBe(false);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("Heading One");
    expect(output).toContain("body text");
  });

  it("reports a friendly error for /md on a missing file", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/md does-not-exist.md", neverConfirm);
    expect(log.mock.calls.some((call) => String(call[0]).includes("cannot preview"))).toBe(true);
  });

  it("falls through unknown slash commands to the intent pipeline", async () => {
    // mock provider plans offline; the injected confirm answers "no"
    const confirm = vi.fn(async () => "no" as const);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(handleLine("/definitely-not-a-command", confirm)).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith("Run this plan? [y]es / [a]ll steps / [n]o");
    expect(log.mock.calls.some((call) => String(call[0]).includes("cancelled"))).toBe(true);
  });

  it("ignores empty lines", async () => {
    await expect(handleLine("   ", neverConfirm)).resolves.toBe(false);
  });
});

describe("tui model & thinking commands (issue #163)", () => {
  it("lists /model and /thinking from the shared catalog", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/help", neverConfirm);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("/model [model]");
    expect(output).toContain("/thinking [on|off] [low|medium|high]");
  });

  it("sets an explicit model with /model <id> and warns when it is unknown", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/model tau-test-model", neverConfirm);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain('Model set to "tau-test-model"');
    expect(output).toContain("not in the cached mock catalog");
    // The write went through the same channel `tau provider use` uses.
    expect(loadConfig().providers["mock"]?.["model"]).toBe("tau-test-model");
  });

  it("keeps the cache-quiet path silent for a known model", async () => {
    updateProviderEntry("mock", { availableModels: ["mock-flash", "mock-pro"] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/model mock-pro", neverConfirm);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain('Model set to "mock-pro"');
    expect(output).not.toContain("not in the cached");
  });

  it("degrades /model to a listing outside interactive sessions", async () => {
    // mock serves a deterministic live catalog (mock-chat, mock-reasoner) —
    // the listing path proves stdin is never touched outside a TTY session.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/model", neverConfirm);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("Models for");
    expect(output).toContain("mock-chat");
    expect(output).toContain("Non-interactive session");
  });

  it("explains the missing catalog instead of hanging", async () => {
    // zai exposes no discovery at all → the honest "no catalog" path.
    setConfigValue("provider", "zai");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/model", neverConfirm);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("No catalog available");
    expect(output).toContain("/model <model-id>");
  });

  it("shows thinking state and capability on /thinking", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/thinking", neverConfirm);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain('Thinking for "mock": provider default.');
    expect(output).toContain("no thinking knobs");
  });

  it("refuses thinking writes for knob-less providers with the reason", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/thinking on high", neverConfirm);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("does not support");
    expect(loadConfig().providers["mock"]?.["thinking"]).toBeUndefined();
  });

  it("validates the mode and effort arguments", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/thinking maybe", neverConfirm);
    await handleLine("/thinking on extreme", neverConfirm);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain('must be "on" or "off"');
    expect(output).toContain("must be low, medium or high");
  });

  it("writes thinking through the normalized layer for a capable provider", async () => {
    setConfigValue("provider", "anthropic");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/thinking on high", neverConfirm);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain('Thinking for "anthropic" set: on (high).');
    const entry = loadConfig().providers["anthropic"];
    expect(entry?.["thinking"]).toBe("on");
    expect(entry?.["thinkingEffort"]).toBe("high");
  });

  it("shows the thinking line on /provider", async () => {
    updateProviderEntry("mock", { thinking: "on", thinkingEffort: "high" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLine("/provider", neverConfirm);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("model:");
    expect(output).toContain("thinking: on (high)");
  });
});
