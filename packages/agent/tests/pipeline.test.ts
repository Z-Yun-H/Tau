/**
 * @tau/agent pipeline tests — catalog assembly (core + skill tools) and the
 * intent -> plan flow against the offline mock provider.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tauHome } from "@tau/core";
import { allTools, getTool, resetRegistry } from "@tau/tools";
import { prepareCatalog, ProviderUnavailableError } from "../src/pipeline.js";
import { planIntent } from "../src/pipeline.js";
import { buildSkillTools } from "../src/skill-tools.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-agent-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
  resetRegistry();
});

describe("prepareCatalog", () => {
  it("registers core tools plus skill-contributed tools", () => {
    const skillsDir = path.join(tauHome(), "skills", "test-skill");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, "SKILL.md"),
      [
        "---",
        "name: test-skill",
        "version: 0.1.0",
        "description: a test skill",
        "commands:",
        "  - name: say-hi",
        "    description: say hello via echo",
        "    command: echo hello-from-skill",
        "    risk: low",
        "---",
        "",
        "Test skill body.",
        "",
      ].join("\n"),
    );

    prepareCatalog();

    expect(getTool("file.find")).toBeDefined();
    const skillTool = getTool("test-skill.say-hi");
    expect(skillTool).toBeDefined();
    expect(allTools().some((tool) => tool.owner === "test-skill")).toBe(true);
  });

  it("skill tool run executes through runShell with placeholders filled", async () => {
    const skillsDir = path.join(tauHome(), "skills", "test-skill");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, "SKILL.md"),
      [
        "---",
        "name: test-skill",
        "description: a test skill",
        "commands:",
        "  - name: greet",
        "    description: greet someone",
        "    command: echo hi {args}",
        "    risk: low",
        "---",
        "",
        "Test skill body.",
        "",
      ].join("\n"),
    );

    const [tool] = buildSkillTools([
      {
        name: "test-skill",
        version: "0.1.0",
        description: "a test skill",
        tags: ["test"],
        risk: "low",
        triggers: ["test"],
        commands: [
          { name: "greet", description: "greet someone", command: "echo hi {args}", risk: "low" },
        ],
        sourcePath: path.join(skillsDir, "SKILL.md"),
        dir: skillsDir,
        origin: "user",
      },
    ]);
    const result = await tool!.run({ values: ["monorepo"] });
    expect(result.text).toContain("hi monorepo");
  });
});

describe("planIntent", () => {
  it("returns a plan from the offline mock provider", async () => {
    const planned = await planIntent("find *.ts files", { provider: "mock" });
    expect(planned.providerName).toBe("mock");
    expect(planned.plan.steps.length).toBeGreaterThan(0);
    expect(planned.plan.steps[0]?.tool).toBe("file.find");
  });

  it("surfaces plugin warnings without failing", async () => {
    const planned = await planIntent("show disk usage", { provider: "mock" });
    expect(Array.isArray(planned.warnings)).toBe(true);
  });

  it("raises ProviderUnavailableError when the provider has no key", async () => {
    await expect(planIntent("find files", { provider: "openai" })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("falls back to the default provider for unknown names", async () => {
    // resolveProvider keeps the CLI usable by degrading to mock — planIntent
    // inherits that contract instead of throwing on unknown names.
    const planned = await planIntent("find files", { provider: "nope" });
    expect(planned.providerName).toBe("mock");
    expect(planned.providerSource).toBe("default");
  });
});
