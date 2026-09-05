# Web 界面

`tau web` 启动本地 Web 界面（默认 `127.0.0.1:8787`，永不暴露到网络）：浏览器里的计划卡片、思考面板与实时工具调用，背后是和 CLI 完全相同的引擎与安全门。

```bash
tau web            # 启动并打开
```

## 两种模式

- **plan 模式**：意图 → 计划卡 → 审查徽章 → 你点 Run → 实时结果卡。高风险计划有卡片级显式确认框，deny 结论硬禁用 Run。
- **agent 模式**：多轮 goal 时间线。每轮显示计划、审查徽章、实时步骤输出；medium+ 轮次内联暂停，卡片上直接 Approve / Refuse，没有"一次性预授权"。

## 思考面板（v0.5.0）

规划进行时，provider 的思考实时流入可折叠面板（流式中钉住展开，完成后折叠为 "Thought for Ns"）；agent 模式下每一轮的规划思考与反思思考分别折叠进所属轮次。token 用量显示在卡片眉行。

## 工具调用卡片与文件查看器（v0.5.0）

agent 轮次里的工具步骤渲染为结构化卡片：工具名、风险徽章、可折叠的参数 JSON、实时输出。`file.read` 步骤则渲染成文件查看器——路径、语言徽章与 shiki 语法高亮正文，语言检测与工具层共享同一份逻辑。

## 斜杠命令菜单（v0.6.0）

在输入框敲下 `/`（或命令前缀，如 `/th`）会浮出命令菜单——`↑`/`↓` 移动、`Tab`/`Enter` 执行、`Esc` 关闭，鼠标悬停/点击同样可用。命令全部在客户端本地执行（`/new` 新线程、`/theme`、`/plan`、`/agent`、`/help`、`/settings`……），**从不作为意图发给 AI**；菜单读取与 TUI 面板同源的共享命令目录（`GET /api/commands`），展示与可执行永远一致。

## 图片附件（v0.6.0）

回形针按钮、直接粘贴（Ctrl/⌘+V）与拖拽三种方式都汇入同一份经过校验的附件列表：PNG/JPEG/WebP/GIF，最多 4 张、单张 ≤4 MB；草稿以可移除的缩略 chip 呈现，只有图片没有文字时发送会用一条明确的默认意图。负载只随请求走一次——用户卡片保留名称/类型/大小（缩略图仅当前会话），对话流事件与 localStorage 中永远没有图片数据。有视觉能力的 provider（openai/anthropic/gemini/ollama）收到原生格式图片；纯文本 provider 会得到诚实的"图片已被丢弃"注记，而不是假装看见。服务端独立复验：媒体类型白名单、张数/大小上限、魔数嗅探（改名文本文件无法冒充图片）。

## 沙箱预览与原生查看（v0.6.0）

- **HTML 预览**：结果/回答中的 ```html 代码块获得 preview 切换——内容在 `<iframe sandbox="allow-scripts">` 中打开（不加 allow-same-origin，不透明源无法触碰父页面、Cookie 与存储）；escape-first 的 markdown 管线一行未动，预览是独立沙箱通道。
- **PDF / 图片原生查看**：`file.read` 读取 PDF 或图片时不再把二进制当文本展示，而是经只读路由 `GET /api/file` 流入浏览器原生查看器（`<embed>` / `<img>`）。该路由工作区收容（复用写工具同一套遏制定义 + realpath 复检，符号链接穿越被封堵）、8 MB 上限、保守 mime 白名单（永不服务 html/js/svg 等可执行类型），403/404/413 语义明确。

## 本地会话

对话线程持久化在浏览器 localStorage（键 `tau-webui-threads-v1`，上限 50 条），服务端 history 才是持久记录；卡片 schema 只增不改。设置面板展示**脱敏后**的有效配置（API key 永远是掩码）。

## 模型与思考选择（v0.6.2）

设置面板的 **provider** 区块升级为可选：模型行是目录驱动的下拉
（`GET /api/models`，含刷新按钮），经 `POST /api/config/model` 写入；
**thinking** 行按服务端能力表渲染 mode（on/off）与 effort（low/medium/high）
分段控件——无旋钮的 provider 如实显示「无思考旋钮」提示，而非死控件。
两项写入与 CLI 同一条 `setConfigValue` 通道；gate 与风险策略依然不可从
浏览器修改。

## Provider 配置（v0.6.1）

设置面板的 **provider setup** 区块——凭据写入面：

- **模型链接查询**：选择 provider 后端点自动带出（来自服务端下发的 provider 目录，与注册表奇偶校验锁定一致），无需手输 URL；高级折叠项可自定义端点（OpenAI 系写 `providers.<name>.baseUrl`，Ollama 写 `host`）。
- **只粘贴 key**：从控制台链接取 key（每条目录附 "get a … key ↗"），粘贴即存；保存走 `POST /api/config/provider`——与 CLI `tau provider set-key` 同一条 `setConfigValue` 通道（0600 配置文件），保存后自动刷新模型目录，并可一键把该 provider 设为当前活跃（keyless 的 mock/ollama/zai 无需 key）。
- **防窥掩码**：key 输入框默认 `password` 型，"show" 显形 8 秒后自动重新掩码；已保存的 key 只以服务端掩码（`sk-***last4`）回显——明文只存在于本机请求体与 0600 配置文件，从不回显、从不进日志。gate/风险策略等安全相关配置仍然**不可**从浏览器修改。
