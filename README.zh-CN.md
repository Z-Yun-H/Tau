# Tau

**AI 驱动的统一终端助手 —— 自然语言进，安全命令出。**

[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](tsconfig.json)
[![Tests](https://img.shields.io/badge/tests-211%20passing-success)](vitest.config.ts)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

Tau 把自然语言意图（中文/英文）变成**经过审查、确认后执行的计划**。它用一个
命令统一了日常终端工作 —— 文件、系统、网络、文本 —— 并让每个 AI 提议的动作
都必须先通过确定性的安全门，才能碰你的机器。

```bash
tau ask "找出所有 TODO 的地方"          # 意图 -> 计划 -> 确认 -> 完成
tau ask "how much disk is left?" --yes  # 仅自动批准低/中风险
tau file find "*.ts"                    # 也可以直接用工具
```

---

## 为什么是 Tau

大多数 AI 终端工具选择"相信模型，然后祈祷"。Tau 反其道而行：
**AI 只负责提议，确定性代码负责裁决。**

- **要计划，不要感觉** —— 模型必须输出严格 JSON（zod 校验），垃圾输出根本到不了 shell。
- **AI 永远不给自己打分** —— 一个经过完整测试的确定性 SafetyReviewer
  （黑名单 + 风险分级 + 步数上限）横亘在每个计划和执行之间。
- **默认 dry-run** —— 所有会改数据的操作（`file.rename`、`text.replace`）先预览，
  真正生效永远需要显式参数。
- **没有删除原语** —— Tau 的一方工具不能删除；危险 shell 命令要么被黑名单拦截，
  要么经过交互确认，否则不执行。
- **离线优先** —— 没有任何 API key 时，`tau` 依然是完整的工具箱（内置 `mock` Provider）。

## 功能总览

| 命令族         | 能力                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| `tau ask`      | 自然语言 → Provider 计划 → 安全审查 → 确认 UI → 执行 → 历史                      |
| `tau file`     | glob 查找（自动跳过 node_modules）、目录树、stat、正则批量重命名（默认 dry-run） |
| `tau sys`      | 系统/CPU/内存信息、磁盘用量、CPU 排行进程                                        |
| `tau net`      | TCP 端口检测、ping、防 SSRF 的 fetch、本机 IP                                    |
| `tau text`     | 正则搜索、全项目替换（默认 dry-run）、行/词统计                                  |
| `tau skill`    | SKILL.md 命令包：list/show/new/validate                                          |
| `tau plugin`   | MCP 工具服务器接入：dsh、VS Code、文件系统……（list/add/remove/tools）            |
| `tau history`  | 所有执行都有记录：查看、重放、清空                                               |
| `tau alias`    | 持久化命令别名（`tau ll` → 任何命令）                                            |
| `tau provider` | API key 管理 + 在线模型发现：配好 key 自动刷新模型列表，交互式选型               |
| `tau config`   | Provider、超时、风险策略 —— 存在 `$TAU_HOME` 下                                  |

## 安装

```bash
git clone https://github.com/Z-Yun-H/Tau.git
cd tau && npm install && npm run build && npm link   # 提供 `tau` 命令
```

需要 Node.js ≥ 20。

## 快速上手

```bash
# 1. 开箱即用（mock provider，完全离线）
tau ask "查找所有 ts 文件"

# 2. 接入真实模型 —— 配好 key 即解锁在线模型目录
tau provider set-key deepseek sk-...     # 存 key（写入配置，chmod 600）
                                         # -> 模型列表自动刷新
tau provider use deepseek                # 从刷新后的列表中选型
tau provider models deepseek             # 或者先浏览一遍

# 偏好环境变量？依旧支持（作为回退）：
tau config set provider openai           # + export OPENAI_API_KEY=...
tau config set provider ollama           # 本地模型，无需 key
tau config set provider zai              # 可选 z-ai-web-dev-sdk

# 3. 日常工具
tau sys info
tau net port 3000 --host localhost
tau text search "TODO" --glob "*.ts"
tau file rename " IMG_([0-9]+)" " -photo-$1"     # 先预览
tau file rename " IMG_([0-9]+)" " -photo-$1" -e  # 确认后执行
```

## 安全模型 30 秒版

```
意图 ──► provider.plan() ──► validatePlanResponse() ──► reviewPlan() ──┬─► deny   （exit 2，什么都没跑）
                                    严格 JSON             │           ├─► review（高风险：强制交互确认，
                                    zod 校验             黑名单       │        --yes 也绝不自动执行）
                                                                       └─► allow （低风险：直接跑 / --yes）
```

- **黑名单**：`sudo`、`rm -rf /`、`curl | sh`、`dd of=/dev/*`、fork 炸弹、
  force-push、`DROP TABLE`…… 计划在确认之前就被拒绝。
- ** caution 名单**：`rm`、`chmod`、`kill`、`git reset --hard`…… 高风险，
  必须交互确认。
- **`--yes` 是诚实的**：它只自动批准低风险（配置 `allowMediumAutoApprove true`
  后含中风险）—— 永不碰高风险与 blocked。
- 完整策略与设计动机：[docs/safety.md](docs/safety.md)。

## AI Provider

| Provider       | 依赖                    | 配置                                                                                                                                                        |
| -------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock`（默认） | 无                      | 离线可用，关键词匹配的演示计划                                                                                                                              |
| `ollama`       | 本地 ollama             | `ollama serve`，模型见 `providers.ollama.model`                                                                                                             |
| `openai`       | `OPENAI_API_KEY`        | 任意 OpenAI 兼容端点：`providers.openai.baseUrl`                                                                                                            |
| `deepseek`     | `DEEPSEEK_API_KEY`      | DeepSeek Harness 适配器（`@deepseek-ai/dsh-llm`）：官方流式 wire 协议、`LlmAdapter` + `StreamChunk` 流协议；model/baseUrl/timeoutMs 见 `providers.deepseek` |
| `zai`          | 可选 `z-ai-web-dev-sdk` | 未安装时优雅提示 unavailable + 修复方法                                                                                                                     |

选择优先级：`--provider` 参数 > `TAU_PROVIDER` 环境变量 > `config.provider`。
未知值 → 安全回落到 `mock`。

API key 解析顺序为 **配置文件（`providers.<name>.apiKey`）→ 环境变量**：
`tau provider set-key` 写入的 key 优先于为其他工具导出的同名环境变量，
CI 场景也可以继续只用环境变量。

### 模型选型：配置 key 后自动刷新目录

各 Provider 内置在线模型发现（openai/deepseek 走 `GET /models`，ollama 走
`/api/tags`）。一旦配置了 key，Tau 会立即拉取模型目录并缓存
（`providers.<name>.availableModels`，24 小时 TTL），选型始终基于真实可用的模型：

```bash
tau provider list                        # key 来源、当前模型、缓存年龄
tau provider set-key deepseek sk-...     # 存 key -> 自动刷新目录
tau provider models [--refresh|--offline]
tau provider use deepseek [model]        # TTY 下方向键交互选型
```

Tau **不内置任何默认模型** —— 模型永远来自这份实时目录或你的显式配置。当目录中
只有一个模型时，Tau 自动选中并持久化；有多个时，`tau ask` 会快速失败并给出
可操作的提示（而不是瞎猜），用 `tau provider use` 选一个即可。

目录展示永不泄漏 key；刷新失败自动降级到缓存列表；
不支持发现端点的 Provider（zai）需要显式设置 `providers.<name>.model`。

## Skills：一个 markdown 文件教会 Tau 新本事

把 `SKILL.md` 放进 `~/.tau/skills/<name>/` 或项目的 `skills/` 目录：

```markdown
---
name: git-helper
version: 0.1.0
description: 只读的 git 工作流快捷方式
risk: low
triggers: [git, commit, branch]
commands:
  - name: status
    description: 查看工作区状态
    command: git status --short --branch
---

使用文档 —— 人和 AI 规划器都会读这段。
```

```bash
tau skill list                 # bundled + user + workspace 三个作用域
tau skill new my-skill "..."   # 从模板生成到 ~/.tau/skills
tau skill validate my-skill    # frontmatter + 黑名单扫描
tau git-helper status          # 声明式命令自动成为 CLI + AI 可调用工具
```

内置示例：[`skills/git-helper`](skills/git-helper/SKILL.md)、
[`skills/docker-helper`](skills/docker-helper/SKILL.md)。
编写指南：[docs/skills-authoring.md](docs/skills-authoring.md)。

## Plugins：通过 MCP 驱动外部工具

Skills 给 Tau 加**命令**；**Plugins 给 Tau 接**[模型上下文协议
](https://modelcontextprotocol.io)（MCP）**工具服务器**。任何 MCP 服务器 ——
[DeepSeek Harness（`dsh`）](https://github.com/deepseek-ai/deepseek-harness)、
VS Code 桥接器、文件系统/GitHub/数据库服务器 —— 都能以与内置工具完全相同的
计划 → 审查 → 确认流水线接入：

```bash
tau plugin add files -- npx -y @modelcontextprotocol/server-filesystem ./project
tau plugin add dsh --url http://127.0.0.1:8787/mcp     # http 传输
tau plugin list                                        # 已配置哪些
tau plugin tools files                                 # 连接检查 + 工具发现

# 工具以 plugin.files.list_directory [risk:medium] 进入 AI 目录
tau ask "在项目里找所有超过 1MB 的文件"
```

插件工具**永远是中风险**（强制交互确认；`--yes` 尊重 `allowMediumAutoApprove`）
—— 第三方能力绝不走快速通道。传输方式：`stdio`（本地进程）与 `http`
（Streamable HTTP 端点）。指南与食谱（dsh / VS Code 接入、安全模型）：
[docs/plugins.md](docs/plugins.md)。

## 为 AI 协作而生

Tau 从设计上就是"给人用、给 AI 维护"的双端项目：

- **[`AGENTS.md`](AGENTS.md)** —— 60 秒项目认知 + 黄金法则 + 提交前门禁
- **[`AGENTS/`](AGENTS/)** —— 分子系统规则书：[架构](AGENTS/architecture.md)、
  [规范](AGENTS/conventions.md)、[测试](AGENTS/testing.md)、
  [技能](AGENTS/skills.md)、[插件](AGENTS/plugins.md)、
  [AI 集成](AGENTS/ai-integration.md)、[发布](AGENTS/release.md)
- **[`.claude/skills/`](.claude/skills)** —— 开发工作流技能（tau-build / tau-test / tau-release / tau-skill-new）
- **`CLAUDE.md`** 指针文件供 Claude Code 自动发现；安全模块完全确定性且有 1:1 测试覆盖
- 172 个测试、严格 TypeScript，`npm run lint && npm run typecheck && npm test` 就是 agent 门禁

## 项目结构

```
src/
  index.ts        CLI 入口（commander）       core/      会话流水线、安全、执行器
  ai/             Provider + Prompt + 计划校验  tools/     注册表 + file/sys/net/text
  plugins/        MCP 客户端 + 插件管理器      skills/    SKILL.md 加载器 + 管理器
  config/         TAU_HOME、配置、历史         cli/       各命令族接线
  ui/             主题 + 确认交互
skills/           内置技能                      templates/ `tau skill new` 模板
tests/            单元 + 集成测试（vitest）     AGENTS/  agent 规则书
```

## 文档

- [架构详解](docs/architecture.md) —— 流水线图、不变量、如何添加工具/Provider
- [安全模型](docs/safety.md) —— 黑白名单、风险语义、为什么没有删除工具
- [技能编写](docs/skills-authoring.md) —— frontmatter 契约、示例、校验规则
- [MCP 插件](docs/plugins.md) —— 接入 dsh / VS Code / 任意 MCP 服务器，安全模型
- [English README](README.md)

## 参与贡献

欢迎 PR —— 从 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md) 开始。
提交前门禁：`npm run lint && npm run typecheck && npm run test:cov`。

## 许可证

[MIT](LICENSE) © 2026 ZHYun
