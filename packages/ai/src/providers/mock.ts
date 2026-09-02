/**
 * Mock provider — deterministic, zero-network.
 * Test fixture, offline demo, and the factory default so `tau ask` degrades
 * gracefully without any AI backend. Keyword-matches plans over the real tool
 * catalog and ships a fake model catalog for the `tau provider` flow.
 *
 * This module deliberately hosts NO shared utility for real providers — the
 * HTTP chat helper lives in `./http.ts`. The mock stays zero-network and
 * self-contained by construction (AGENTS/ai-integration.md).
 */

import type {
  AgentDecision,
  AIProvider,
  ModelInfo,
  Plan,
  PlanningContext,
  ProviderUsage,
  ReflectContext,
} from "@tau/core";

/**
 * Mock provider — deterministic, zero-network.
 * Doubles as: test fixture, offline demo, and the default provider so `tau ask`
 * degrades gracefully when no AI backend is configured.
 */
export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly label = "Mock (offline demo)";

  /**
   * Synthetic token usage for the observability baseline (issue #98) —
   * deterministic (length-derived) so tests can assert the plumbing end to
   * end without a network. Updated by plan() and reflect().
   */
  lastUsage: ProviderUsage | undefined = undefined;

  private recordUsage(seed: string, reply: string): void {
    const promptTokens = 40 + seed.length;
    const completionTokens = 20 + reply.length;
    this.lastUsage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  /** Fake catalog so the `tau provider` flow is fully demonstrable offline. */
  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "mock-chat", ownedBy: "tau" },
      { id: "mock-reasoner", ownedBy: "tau" },
    ];
  }

  async plan(ctx: PlanningContext): Promise<Plan> {
    const intent = ctx.intent.toLowerCase();
    const isChinese = /[\u4e00-\u9fff]/.test(ctx.intent);

    // Keyword scoring over the real tool catalog keeps the demo honest.
    if (/find|查找|搜索文件|找.*文件|glob/.test(intent)) {
      const pattern = intent.match(/(\*[\w.*-]*|\*\*)/)?.[1] ?? "*.ts";
      const explanation = isChinese
        ? `在当前目录下递归查找匹配 ${pattern} 的文件`
        : `Recursively find files matching ${pattern} under the current directory`;
      this.recordUsage(ctx.intent, explanation);
      return {
        explanation,
        steps: [
          {
            kind: "tool",
            tool: "file.find",
            args: { pattern, path: "." },
            reason: "keyword matched file lookup",
          },
        ],
        selfAssessedRisk: "low",
      };
    }

    if (/disk|磁盘|空间|storage|df/.test(intent)) {
      return {
        explanation: isChinese
          ? "查看当前路径的磁盘使用情况"
          : "Show disk usage for the current path",
        steps: [{ kind: "tool", tool: "sys.disk", args: { path: "." }, reason: "disk keyword" }],
        selfAssessedRisk: "low",
      };
    }

    if (/ping|连通|网络.*通/.test(intent)) {
      const host = intent.match(/(?:ping\s+|测试\s*)([\w.-]+\.\w+)/)?.[1] ?? "example.com";
      return {
        explanation: `Ping ${host} four times`,
        steps: [
          { kind: "tool", tool: "net.ping", args: { host, count: 4 }, reason: "ping keyword" },
        ],
        selfAssessedRisk: "low",
      };
    }

    if (/cpu|进程|process|内存|memory/.test(intent)) {
      return {
        explanation: "Show top processes by CPU",
        steps: [{ kind: "tool", tool: "sys.proc", args: { limit: 10 }, reason: "process keyword" }],
        selfAssessedRisk: "low",
      };
    }

    if (/search|文本|替换|replace|count|统计/.test(intent)) {
      const pattern = intent.match(/["'`](.+?)["'`]/)?.[1] ?? "TODO";
      return {
        explanation: `Search text "${pattern}" in all files`,
        steps: [
          {
            kind: "tool",
            tool: "text.search",
            args: { pattern, glob: "*" },
            reason: "text keyword",
          },
        ],
        selfAssessedRisk: "low",
      };
    }

    // Fallback: harmless echo, showing the strict-JSON contract works.
    const note = isChinese
      ? `离线 mock 无法理解「${ctx.intent}」。配置真实 AI Provider 后重试：tau config set provider openai`
      : `Offline mock could not map "${ctx.intent}". Configure a real provider: tau config set provider openai`;
    this.recordUsage(ctx.intent, note);
    return {
      explanation: note,
      steps: [
        {
          kind: "shell",
          command: `echo "tau mock: ${ctx.intent.replace(/"/g, "'")}"`,
          reason: "fallback echo",
        },
      ],
      selfAssessedRisk: "low",
    };
  }

  /**
   * Deterministic reflection for tests and offline demos of the agent loop.
   *
   * Decision table (keyword-driven, zero-network):
   * - last round `ok` + outputs contain "GOAL_COMPLETE" → done (answer
   *   echoes the marker's tail, letting tests assert end-to-end data flow)
   * - last round `ok` (no marker) → one more round: a `file.find` probe,
   *   so multi-round loops have a cheap deterministic second act
   * - last round `failed` → one repair round: `echo` the failure back
   *   (deterministic, low-risk, exercisable end-to-end)
   * - `cancelled`/`denied` never reach reflection (the loop stops first)
   */
  async reflect(ctx: ReflectContext): Promise<AgentDecision> {
    const last = ctx.rounds[ctx.rounds.length - 1];
    if (!last) {
      const empty = "No executed rounds to reflect on.";
      this.recordUsage("reflect", empty);
      return { done: true, answer: empty };
    }
    const joined = last.outputs.join("\n");
    const marker = joined.match(/GOAL_COMPLETE[:\s]*(.*)/)?.[1]?.trim();

    if (last.status === "ok" && marker !== undefined) {
      const answer = marker || "Goal complete.";
      this.recordUsage("reflect", answer);
      return { done: true, answer };
    }
    if (last.status !== "ok") {
      this.recordUsage("reflect", "mock repair");
      return {
        done: false,
        plan: {
          explanation: `Mock repair round: previous round failed (${joined.slice(0, 80) || "no output"})`,
          steps: [
            {
              kind: "shell",
              command: 'echo "mock repair: retry after failure"',
              reason: "deterministic repair probe",
            },
          ],
          selfAssessedRisk: "low",
        },
        note: "mock repair",
      };
    }
    this.recordUsage("reflect", "mock continue");
    return {
      done: false,
      plan: {
        explanation: "Mock continue: probe the workspace once more before concluding.",
        steps: [
          {
            kind: "tool",
            tool: "file.find",
            args: { pattern: "*.ts", path: "." },
            reason: "deterministic continue probe",
          },
        ],
        selfAssessedRisk: "low",
      },
      note: "mock continue",
    };
  }
}
