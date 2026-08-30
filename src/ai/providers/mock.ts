import { theme } from "../../ui/theme.js";
import { validatePlanResponse } from "../prompt.js";
import type { AIProvider, Plan, PlanningContext } from "../../types.js";

/**
 * Mock provider — deterministic, zero-network.
 * Doubles as: test fixture, offline demo, and the default provider so `tau ask`
 * degrades gracefully when no AI backend is configured.
 */
export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly label = "Mock (offline demo)";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async plan(ctx: PlanningContext): Promise<Plan> {
    const intent = ctx.intent.toLowerCase();
    const isChinese = /[\u4e00-\u9fff]/.test(ctx.intent);

    // Keyword scoring over the real tool catalog keeps the demo honest.
    if (/find|查找|搜索文件|找.*文件|glob/.test(intent)) {
      const pattern = intent.match(/(\*[\w.*-]*|\*\*)/)?.[1] ?? "*.ts";
      return {
        explanation: isChinese
          ? `在当前目录下递归查找匹配 ${pattern} 的文件`
          : `Recursively find files matching ${pattern} under the current directory`,
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
}

/** Shared JSON-over-HTTP chat helper for ollama/openai-style providers. */
export async function chatJSON(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 60000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`${theme.error(`HTTP ${res.status}`)} from provider: ${detail}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export { validatePlanResponse };
