# 架构总览

Tau 是一个 pnpm workspace monorepo：`packages/` 是能力层，`app/` 是界面层，全部 TypeScript ESM。核心原则是**依赖单向**——界面层依赖能力层，能力层互相之间只依赖更底层。

## 包结构

```
packages/
  core/      类型、配置、工具注册表契约（ToolDefinition / ToolResult）
  tools/     确定性工具层：file/sys/net/text 四族内置工具
  engine/    执行与安全：reviewPlan() 确定性审查 + runPlan() 唯一执行通道
  ai/        provider 抽象：AIProvider 接口 + 七家实现 + 流式 wire 层
  skills/    技能运行时 + 随 CLI 发布的内置技能（产品内容）
  plugins/   MCP 客户端层（插件工具一律 medium risk）
  agent/     编排：ask/goal 共用的目录装配与规划管线
  ui/ markdown/  终端渲染原语 / 双形态 markdown（HTML + ANSI）
app/
  cli/ tui/ webui/   三种界面，同一引擎同一道门
```

## 核心管线

```
意图 → provider.plan() → validatePlanResponse()（zod 严格 JSON）
     → reviewPlan()（确定性安全审查）→ 用户确认 → runPlan()（唯一执行通道）
```

三个不变量：(1) AI 永不自我评分——审查是确定性代码；(2) `runPlan()` 是唯一执行通道，不存在旁路；(3) 计划是严格 JSON，宽松输出会被校验拒绝。

## 流式层（v0.5.0）

`packages/ai/src/chat-stream.ts` 是统一流式 wire 层：四种 wire 协议（OpenAI SSE、Anthropic Messages SSE、Gemini `alt=sse`、Ollama NDJSON）被折叠成 provider 无关的 `ProviderStreamEvent`（`reasoning_delta` / `text_delta` / `usage`）。agent 层（`planIntentStream` / `runGoal` 的 `onPlanStream`）与 WebUI（`/api/plan/stream`、思考面板）直接消费同一种事件形状，层层透传、不再转换。

## 目录治理

仓库对"什么放哪里"有规范性约束（见 `AGENTS/architecture.md` 的 directory governance 表）：AI 行为文档在根部 `AGENTS*`；跨切面的开发技能在 `.claude/skills/`；单包技能挨着它治理的代码；随 CLI 发布的技能是产品内容（运行时数据），在 `packages/skills/bundled/`；文档站是独立私有工作区 `docs-site/`。
