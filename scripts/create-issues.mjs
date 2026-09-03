/**
 * Publish the compound-request decomposition plan as GitHub Issues
 * (AGENTS/collaboration.md §3 — publication BEFORE implementation).
 * Run: node scripts/create-issues.mjs
 */
const TOKEN = process.env.TAU_TOKEN;
const REPO = "Z-Yun-H/Tau";

const issues = [
  {
    title:
      "[PLAN] 复合需求分解公示：WebUI 流式/思考/工具显示/高亮 + AI provider 重构 + VitePress 文档站（v0.5.0）",
    body: `## 来源指令

维护者一次性下达的复合需求（原文）：

> 功能 ui：增加思考模式，流式输出，工具调用显示，文档/文件 高亮
> 文档：使用 vitepress 搭建网站，依据项目功能自动分解文档内容构成，页面工具使用要清晰，同时创建文档 skill，用于文档构建开发
> 工具：对于前端的功能变更，酌情添加工具的更改
> ai：参考各个主流大模型开发文档，对库内的 provider 重构

## 分解方案（一单元一 Issue 一 PR）

本需求跨越 ai / agent / tools / webui / docs 五个子系统，构成大型重构（≥3 子系统），按 AGENTS/collaboration.md §3 采用**集成分支统一合并**模式：

- 集成分支：\`release/v0.5.0-webui-ai-docs\`
- 全部单元 PR base 指向该集成分支，按下列次序逐个合入
- 最后一个单元为发布单元（版本升级 + CHANGELOG 归档）
- 全部合入后开**一个总 PR**（集成 → main），**留维护者人工合并**

| # | 单元 | 类型 | Issue | 依赖 |
|---|------|------|-------|------|
| 1 | AI provider 重构：统一流式/思考/usage 抽象 + anthropic/gemini | refactor | #106 | — |
| 2 | agent 流式规划管线 planIntentStream + goal 思考增量 | feat | #107 | 1 |
| 3 | tools：file.read 结构化数据（path/language）供前端高亮 | feat | #108 | — |
| 4 | WebUI：/api/plan/stream + 思考面板 + 工具调用卡片 + 文件高亮 | feat | #109 | 2,3 |
| 5 | VitePress 中英双语文档站 + tau-docs 文档构建技能 | docs | #110 | 1-4（内容定稿后） |
| 6 | 发布单元：v0.5.0 版本升级 + CHANGELOG 归档 + 总 PR | chore(release) | #111 | 1-5 |

## 实施顺序依据

规范/文档先行 → 重构 → 功能 → 发布（AGENTS/collaboration.md §3）。单元 1 是 2/4 的地基（流式事件类型与 provider 能力）；单元 3 独立可并行；单元 5 依赖功能定稿后的内容分解；单元 6 恒最后。

## 技术选型声明（需维护者批准项）

- 新增 dev 依赖：\`vitepress\`（文档站构建，\`@tau/docs-site\` 工作区专用 devDep，进 catalog）——单元 5
- 运行时依赖**零新增**：anthropic/gemini provider 全部纯 fetch 实现（沿用仓库"可选 SDK 动态导入"豁免模式之外的最保守路径）
- AIProvider 接口新增**可选** \`planStream()\` 能力（不改写既有契约，非流式 provider 原样回退）

## 门禁承诺

每个单元 PR：\`pnpm lint && pnpm typecheck && pnpm build && pnpm test\` 全绿 + 新行为带测试 + 双语文档同步 + \`CHANGELOG.md\` Unreleased 片段 + 每日 \`changelog/2026-09-03.md\` 批次 + AI 声明尾注。

---

AI-Generated: 复合需求分解方案公示（单元清单/顺序/依赖/选型声明）
AI-declaration: this commit was authored by an AI agent under human direction.
AI-agent: Super Z (GLM)
AI-scope: 本 Issue 仅公示分解方案，不含任何代码变更`,
  },
  {
    title:
      "[Unit 1][REFACTOR] AI provider 重构：统一流式 SSE 抽象（text/reasoning/tool-call/usage 事件）+ anthropic / gemini provider",
    body: `## 动机

参考 OpenAI Chat Completions (SSE)、Anthropic Messages (content_block_delta / thinking delta)、Google Gemini streamGenerateContent?alt=sse、Ollama /api/chat NDJSON 等主流 wire 协议，把 \`packages/ai\` 的 provider 层重构到**统一流式抽象**上，为 WebUI 思考模式/流式输出提供数据源。

## 方案

- 新增 \`packages/ai/src/chat-stream.ts\`：provider 无关的 \`ChatStreamEvent\` 事件协议（text_delta / reasoning_delta / tool_call_delta / usage / done）+ 各 wire 的共享 SSE 解析（OpenAI-compatible、Anthropic、Gemini、Ollama NDJSON）
- \`AIProvider\` 新增**可选** \`planStream(ctx, onEvent)\`：流式产出 reasoning/text 增量并返回同一个 zod 验证的 Plan；未实现的 provider 原样回退 \`plan()\`（零破坏）
- openai：共享 OpenAI-compatible SSE 客户端（\`reasoning_content\` 增量支持——兼容 DeepSeek-R1/GLM 等经 OpenAI 端点暴露的思考模型）
- deepseek：直连回退路径对齐共享 SSE 层（harness 路径保持官方 StreamChunk 协议不变）
- ollama：\`/api/chat\` NDJSON 流式 + thinking 增量透传
- zai：保持 SDK 路径，planStream 以单事件非流式降级
- mock：新增确定性 planStream（离线演示/测试/截图全链路可用）
- **新增 provider**：\`anthropic\`（Messages API，x-api-key + anthropic-version，/v1/models 发现，extended thinking 可选）、\`gemini\`（generativelanguage REST，responseMimeType JSON 模式，thought parts 透传，/v1beta/models 发现）——均纯 fetch 零新依赖
- registry / DEFAULT_CONFIG.providers / 双语 README provider 表同步

## 红线

- plan 契约（strict JSON + zod）字节不变；\`reviewPlan()\` 不动；mock 保持自包含
- 测试全部 stub fetch，绝不打真端点

Closes 本单元后回链分解公示 Issue。

---

AI-Generated: 单元 Issue 创建（AI 参与痕迹）`,
  },
  {
    title: "[Unit 2][FEAT] agent 流式规划管线：planIntentStream + runGoal 思考/文本增量事件",
    body: `## 动机

WebUI 需要在 planning 阶段拿到 provider 的思考/文本增量（Unit 1 的数据源），\`@tau/agent\` 需要一个流式版管线。

## 方案

- \`packages/agent/src/pipeline.ts\`：新增 \`planIntentStream(intent, options, onEvent)\` —— provider 有 \`planStream\` 则走流式，否则回退 \`plan()\`；事件统一为 \`PlanningStreamEvent\`（reasoning_delta / text_delta / usage），返回值与 \`PlannedIntent\` 同形
- \`packages/agent/src/loop.ts\`：\`RunGoalOptions\` 新增可选 \`onPlanStream(event, round)\`，每轮规划把思考/文本增量透传给 front door；无则零行为变化
- 事件形状只增不改（additive-only），既有 goal 事件测试全部保持
- 测试：mock provider 事件序列、回退路径、goal 透传

依赖：Unit 1（#106）`,
  },
  {
    title: "[Unit 3][FEAT] tools：file.read 结构化数据补充（path / language）供前端文件高亮",
    body: `## 动机

WebUI 文件/文档高亮（Unit 4）需要知道读出的文件是什么语言。\`file.read\` 已有 \`data = { offset, returned, totalLines, truncated }\`，补充 \`path\` 与 \`language\` 即可让前端把 \`file.read\` 输出渲染成带语法高亮 + 行号的文件查看器。

## 方案

- \`packages/tools/src/file.ts\`：新增 \`languageForFile(name)\` 扩展名→语言 id 映射（ts/js/json/py/yaml/md/html/css/sh/go/rs/java/c/cpp/sql/toml/dockerfile…，未知回落 text），readTool data 增加 \`path\`（用户传入的相对路径）与 \`language\`
- 导出 \`languageForFile\` 供 \`@tau/webui\` 复用（registry barrel）
- 纯增量：\`text\` 输出与风险级别不变，既有测试保持
- 测试：映射覆盖 + readTool data 断言

依赖：无（可与 Unit 1 并行）`,
  },
  {
    title: "[Unit 4][FEAT] WebUI：/api/plan/stream + 思考面板 + 工具调用卡片 + 文件高亮",
    body: `## 动机

前端四大功能落地（依赖 Unit 1/2/3 的数据源）。

## 方案

**Server（零依赖 node:http 不变）**
- \`POST /api/plan/stream\`：NDJSON 流式规划——\`reasoning_delta\` / \`text_delta\` / \`usage\` / 终态 \`plan\`（与 /api/plan 响应同形）/\`error\`；provider 不可用仍以纯 JSON 503 拒绝（流前拒绝）
- \`/api/goal/stream\` 透传 \`onPlanStream\` → \`round_thinking_delta\` / \`round_text_delta\`（additive-only）

**Client（Vue3 + UnoCSS，DESIGN.md 语言）**
- **思考模式**：\`ThinkingPanel.vue\`——planning 期思考 delta 实时流入（灰度斜体），完成后折叠为"已深度思考 · Ns"可回看；goal 每轮同样挂载
- **流式输出**：submitIntent 切到 /api/plan/stream，plan 文本增量进 mono 预览区，plan_ready 后渲染结构化 PlanCard（既有审查/Run 闸门原样）
- **工具调用显示**：\`ToolCallCard.vue\`——工具名 + RiskBadge（查 /api/tools）+ 参数 JSON（可折叠）+ 实时输出；执行流 step_start 升级为结构化工具调用行（ResultCard/GoalCard 复用）
- **文件/文档高亮**：file.read 步骤输出渲染为文件查看器（文件名 + shiki 高亮 + 行号对齐），shiki 语言集扩展（yaml/toml/markdown/html/css/dockerfile/go/rust/java/sql）
- localStorage 卡片 schema 只增不改（v1 兼容）

**测试**：server-stream 新端点 NDJSON 形状/拒绝路径；goal 透传事件；DOM-free 的事件折叠纯函数测试

依赖：Unit 2（#107）、Unit 3（#108）`,
  },
  {
    title: "[Unit 5][DOCS] VitePress 中英双语文档站（按功能自动分解）+ tau-docs 文档构建技能",
    body: `## 动机

维护者指令：用 VitePress 搭建文档网站，依据项目功能自动分解文档内容构成，页面/工具使用清晰，同时创建文档 skill。

## 方案

**站点（新工作区 \`@tau/docs-site\`，devDep: vitepress + vue 进 catalog）**
- 目录 \`docs-site/\`，srcDir \`docs-site/src\`，zh 默认 locale + en locale
- 内容按功能分解（源自 README×2 / docs/*.md / AGENTS，重写为页面而非搬运）：
  - 指南：快速开始 / tau ask / tau goal（agent 模式）/ 内置工具（file·sys·net·text 全表）/ provider 配置（7 家）/ skills / plugins(MCP) / WebUI / TUI / 配置
  - 参考：架构总览 / 安全模型 / provider 接入指南 / skill 编写 / changelog
- 本地搜索（local search）、暗色跟随、τ 品牌色对齐 WebUI \`--tau-*\`
- 根脚本：\`pnpm docs:dev / docs:build / docs:preview\`；CI 不强制（devDep 不进 prod audit）

**文档 skill（L1 dev-workflow）**
- \`.claude/skills/tau-docs/SKILL.md\`：何时触发/内容源映射（哪个改动该落哪页）/ 双语同步规则 / 构建校验流程
- 根 \`SKILL.md\` 路由表登记 docs → tau-docs
- AGENTS/architecture.md 目录治理表补 \`docs-site/\` 行

依赖：Unit 1-4（内容定稿）`,
  },
  {
    title: "[Unit 6][RELEASE] v0.5.0 发布单元：版本升级 + CHANGELOG 归档 + 总 PR（人工合并）",
    body: `## 方案

- 全工作区 package.json 0.4.0 → **0.5.0**（lockstep，release workflow 校验 tag=version）
- \`CHANGELOG.md\`：Unreleased 整体归档为 \`## v0.5.0 — 2026-09-03\`（导语 + Added/Changed 分类）
- 双语 README：provider 表（anthropic/gemini）、WebUI 功能段、文档站链接
- \`changelog/2026-09-03.md\`：全部批次汇总（各单元批次已随 PR 落地）
- **总 PR**：release/v0.5.0-webui-ai-docs → main，正文含版本说明 + 全部单元 Issue/PR 索引 + 门禁结果汇总，**留维护者人工合并（AI 永不合并）**

依赖：Unit 1-5 全部合入后最后执行`,
  },
];

let created = 0;
for (const issue of issues) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ title: issue.title, body: issue.body }),
  });
  if (!res.ok) {
    console.error(`FAIL ${issue.title}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const json = await res.json();
  created++;
  console.log(`#${json.number} ${json.title}`);
}
console.log(`created ${created} issues`);
