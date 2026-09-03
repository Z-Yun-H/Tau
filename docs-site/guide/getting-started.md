# 安装与快速上手

Tau 是一个运行在终端里的 AI 助手：你用自然语言说出意图，它生成一个结构化的执行计划，计划先经确定性安全审查、再由你确认，然后才会执行。它不是"AI 直接敲命令"，而是"AI 提议、规则审查、你来拍板"。

## 安装

Tau 以 pnpm monorepo 组织，从源码运行或构建：

```bash
git clone https://github.com/Z-Yun-H/Tau.git
cd Tau
pnpm install
pnpm build

# 管道友好模式（CLI）
pnpm dev -- file find "*.ts"

# 多轮代理模式
pnpm dev -- goal "把 src 下所有 .bak 文件整理进 cleanup 目录"
```

## 三条使用路径

| 模式  | 命令               | 适合                         |
| ----- | ------------------ | ---------------------------- |
| CLI   | `tau ask "<意图>"` | 管道、脚本、一次性问答       |
| TUI   | `tau tui`          | 键盘流的全屏交互             |
| WebUI | `tau web`          | 浏览器里的思考面板与工具卡片 |

所有三种界面共享同一个引擎与同一道安全门——在 WebUI 里看到的审查结论，与 CLI 里完全一致。

## 配置一个 Provider

Tau 需要至少一个 AI provider 才能规划。最快的开始方式：

```bash
# 用任意一家（示例：DeepSeek）
tau config set providers.deepseek.apiKey "sk-..."
tau config set provider deepseek
```

没有网络或暂时不想配 key？内置的 `mock` provider 会输出确定性的计划与思考轨迹，整条管线（包括 WebUI 的流式思考面板）都可以离线演示。

## 60 秒理解安全模型

每次执行前发生三件事：**计划**（provider 产出严格 JSON 的步骤列表）→ **审查**（确定性代码审查，不是 AI 自我评分）→ **确认**（高风险步骤必须显式批准）。`runPlan()` 是唯一执行通道，不存在旁路。详见[安全模型](/reference/safety)。
