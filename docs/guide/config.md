# 配置参考

Tau 的配置存在 `$TAU_HOME/config.json`（默认 `~/.tau/config.json`），全部通过 `tau config` 命令读写：

```bash
tau config list                        # 查看有效配置（API key 脱敏）
tau config set provider deepseek       # 设置默认 provider
tau config get provider                # 读取单项
```

## 顶层键

| 键                       | 类型     | 说明                                                         |
| ------------------------ | -------- | ------------------------------------------------------------ |
| `provider`               | string   | 默认 provider 注册名（未知名称回退 mock 并附说明）           |
| `timeout`                | number   | 全局超时（秒）                                               |
| `allowMediumAutoApprove` | boolean  | 是否允许 medium 步骤自动批准（默认 false——写操作永远要确认） |
| `shell`                  | string   | shell 步骤使用的 shell                                       |
| `aliases`                | object   | 命令别名                                                     |
| `plugins`                | string[] | 已注册的 MCP 插件                                            |

## provider 子配置

每个 provider 的可用字段是**白名单制**：`apiKey`、`baseUrl`、`host`、`model`、`timeoutMs`，以及 v0.5.0 的思考开关 `think`（ollama）、`thinking` + `thinkingBudget`（anthropic）、`thinkingBudget`（gemini）。

```bash
tau config set providers.ollama.think true
tau config set providers.openai.baseUrl "https://your-proxy.example.com/v1"
tau config set providers.openai.model "gpt-4o-mini"
```

`DEFAULT_CONFIG.providers` 刻意不携带任何默认模型。API key 永远不在任何日志或 WebUI 响应里明文出现（统一经 `redactConfig` 脱敏）。

## 环境变量

- `TAU_HOME`：运行时数据根目录（skills、config、history）。
- `TAU_PROVIDER`：provider 选择的环境变量层（优先级在 config 之上、`--provider` 之下）。
- `GOOGLE_API_KEY` / `GEMINI_API_KEY`：Gemini provider 的 key 回退。

## 原则

配置修改只发生在 CLI（`tau config set`）。WebUI 的设置面板是**只读**的——浏览器永远不是安全相关配置的第二写入路径。
