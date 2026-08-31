/**
 * Session service tests — the shared UI-facing facts (active provider,
 * provider availability, skill summaries, history, session info) and the
 * planAndReview front half of the intent pipeline. TAU_HOME is sandboxed per
 * test; no network (mock provider + local-only availability checks).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureCatalog,
  getActiveProvider,
  getSessionInfo,
  listProviderAvailability,
  listSkillSummaries,
  listToolSummaries,
  planAndReview,
  readRecentHistory,
  readTauVersion,
} from "../src/session.js";
import { appendHistory } from "@tau/core";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-agent-session-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(path.join(tmp, "home"), { recursive: true });
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("session services", () => {
  it("resolves the active provider with its source and model", () => {
    const active = getActiveProvider();
    expect(active.name).toBe("mock");
    // DEFAULT_CONFIG.provider is "mock", so the resolution source is config,
    // not the hard default.
    expect(active.source).toBe("config");
    expect(active.model).toBe("(auto)");
  });

  it("lists availability for every registered provider", async () => {
    const availability = await listProviderAvailability();
    const names = availability.map((p) => p.name);
    expect(names).toContain("mock");
    expect(names).toContain("openai");
    expect(availability.find((p) => p.name === "mock")?.available).toBe(true);
  });

  it("summarizes discovered skills including the bundled ones", () => {
    const skills = listSkillSummaries();
    const gitHelper = skills.find((s) => s.name === "git-helper");
    expect(gitHelper).toBeDefined();
    expect(gitHelper?.origin).toBe("bundled");
    expect(gitHelper?.risk).toBe("low");
    expect(gitHelper?.commands).toBeGreaterThan(0);
  });

  it("reads recent history newest-first", () => {
    appendHistory("first intent", "direct", [], "ok");
    appendHistory("second intent", "direct", [], "ok");
    const entries = readRecentHistory(5);
    expect(entries.length).toBe(2);
    expect(entries[0]?.input).toBe("second intent");
  });

  it("snapshots session info for status surfaces", async () => {
    const info = await getSessionInfo();
    expect(info.version).toBeTruthy();
    expect(info.version).not.toBe("0.0.0-dev");
    expect(info.tauHome).toBe(path.join(tmp, "home"));
    expect(info.provider.name).toBe("mock");
    expect(info.providers.length).toBeGreaterThan(1);
    expect(info.skillsCount).toBeGreaterThan(0); // bundled skills
    expect(info.pluginsCount).toBe(0);
  });

  it("builds the catalog once and keeps it idempotent", () => {
    expect(() => {
      ensureCatalog();
      ensureCatalog();
    }).not.toThrow();
  });

  it("plans and reviews an intent end-to-end with the mock provider", async () => {
    const planned = await planAndReview("find all ts files");
    expect(planned.providerName).toBe("mock");
    expect(planned.plan.steps[0]?.tool).toBe("file.find");
    expect(planned.review.verdict).toBeDefined();
    expect(planned.review.overallRisk).toBeDefined();
  });

  it("reviews the mock fallback plan through planAndReview", async () => {
    // The mock provider only ever proposes low-risk plans (its fallback is a
    // harmless echo); deny paths are covered by engine and webui suites.
    const planned = await planAndReview("say hello in the terminal");
    expect(planned.providerName).toBe("mock");
    expect(planned.review.verdict).toBe("allow");
    expect(planned.review.overallRisk).toBe("low");
  });

  it("reports a real package version, not the dev fallback", () => {
    expect(readTauVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("lists tool summaries as pure data (catalog built on demand)", () => {
    const tools = listToolSummaries();
    // The built-in file/sys/net/text families must be registered.
    const names = tools.map((t) => t.name);
    for (const expected of ["file.find", "file.rename", "text.replace", "sys.info", "net.fetch"]) {
      expect(names).toContain(expected);
    }
    const find = tools.find((t) => t.name === "file.find");
    expect(find?.risk).toBe("low");
    expect(find?.owner).toBe("core");
    expect(find?.params.some((p) => p.name === "pattern" && p.required)).toBe(true);
    // Medium-risk mutation tools keep their intrinsic risk.
    expect(tools.find((t) => t.name === "file.rename")?.risk).toBe("medium");
    // The serialized shape is pure data — the executable never leaks.
    expect(JSON.stringify(tools)).not.toContain('"run"');
    expect(find && Object.keys(find).sort()).toEqual([
      "description",
      "name",
      "owner",
      "params",
      "risk",
    ]);
  });
});
