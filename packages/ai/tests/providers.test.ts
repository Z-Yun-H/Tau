import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/ai/providers/mock.js";
import { OllamaProvider } from "../src/ai/providers/ollama.js";
import { OpenAIProvider } from "../src/ai/providers/openai.js";
import { planningContext } from "../src/ai/prompt.js";
import { registerCoreTools } from "@tau/tools";

registerCoreTools();

describe("MockProvider", () => {
  const provider = new MockProvider();

  it("is always available", async () => {
    await expect(provider.isAvailable()).resolves.toBe(true);
  });

  const ctx = (intent: string) => planningContext(intent, "");

  it("maps file-find intent (English) to file.find", async () => {
    const plan = await provider.plan(ctx("find all test files"));
    expect(plan.steps[0]?.kind).toBe("tool");
    expect(plan.steps[0]?.tool).toBe("file.find");
  });

  it("maps file-find intent (Chinese) to file.find", async () => {
    const plan = await provider.plan(ctx("帮我查找所有 ts 文件"));
    expect(plan.steps[0]?.tool).toBe("file.find");
  });

  it("maps disk intent to sys.disk", async () => {
    const plan = await provider.plan(ctx("磁盘空间还有多少"));
    expect(plan.steps[0]?.tool).toBe("sys.disk");
  });

  it("maps process intent to sys.proc", async () => {
    const plan = await provider.plan(ctx("what is eating my cpu"));
    expect(plan.steps[0]?.tool).toBe("sys.proc");
  });

  it("maps ping intent with host extraction", async () => {
    const plan = await provider.plan(ctx("ping example.com"));
    expect(plan.steps[0]?.tool).toBe("net.ping");
    expect(plan.steps[0]?.args?.["host"]).toBe("example.com");
  });

  it("falls back to a harmless echo for unknown intents", async () => {
    const plan = await provider.plan(ctx("something completely different"));
    expect(plan.steps[0]?.kind).toBe("shell");
    expect(plan.steps[0]?.command).toMatch(/^echo /);
  });

  it("never produces deny-worthy plans", async () => {
    for (const intent of ["delete everything", "rm -rf the moon", "sudo make me a sandwich"]) {
      const plan = await provider.plan(ctx(intent));
      // Even if it wanted to, the reviewer would catch it; here we assert the
      // mock itself never emits dangerous commands.
      const command = plan.steps[0]?.command ?? "";
      expect(command.startsWith("echo ")).toBe(true);
    }
  });
});

describe("OllamaProvider availability probe", () => {
  it("is unavailable when no local server answers", async () => {
    const provider = new OllamaProvider();
    // No ollama in CI; host is localhost by default.
    const available = await provider.isAvailable();
    if (!available) {
      expect(provider.unavailableReason?.()).toMatch(/ollama serve/i);
    }
  });
});

describe("OpenAIProvider key handling", () => {
  it("reports missing key as unavailableReason", async () => {
    const provider = new OpenAIProvider();
    const had = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(provider.isAvailable()).resolves.toBe(false);
      expect(provider.unavailableReason()).toMatch(/OPENAI_API_KEY/);
    } finally {
      if (had) process.env.OPENAI_API_KEY = had;
    }
  });
});
