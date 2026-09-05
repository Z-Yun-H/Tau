# AI Provider

Tau 与 provider 之间是一份窄接口（`AIProvider`）：`plan()` 把意图变成严格 JSON 计划，可选的 `listModels()` 做模型发现，可选的 `planStream()` / `reflect()` / `reflectStream()` 提供流式规划与多轮反思。v0.5.0 起内置七家：

| Provider      | 注册名      | 流式思考                           | 反思 | 备注                             |
| ------------- | ----------- | ---------------------------------- | ---- | -------------------------------- |
| OpenAI 兼容   | `openai`    | ✓（SSE + `reasoning_content`）     | ✓    | 任何 chat/completions 兼容端点   |
| DeepSeek      | `deepseek`  | ✓（含 harness 路径）               | –    | 官方 harness 可选                |
| Anthropic     | `anthropic` | ✓（Messages SSE `thinking_delta`） | ✓    | 可选扩展思考 + thinkingBudget    |
| Google Gemini | `gemini`    | ✓（`alt=sse` thought parts）       | ✓    | JSON 模式 responseMimeType       |
| Ollama        | `ollama`    | ✓（NDJSON）                        | –    | 本地模型，`think: true` 请求思考 |
| Z.ai          | `zai`       | ✓（诚实单帧降级）                  | –    | GLM 系列                         |
| Mock          | `mock`      | ✓（确定性轨迹）                    | ✓    | 离线演示/测试，永远可用          |

所有 provider 都是纯 `fetch` 实现——零新增运行时依赖，API key 与端点走统一的配置约定。

## 配置

```bash
tau config set provider anthropic
tau config set providers.anthropic.apiKey "sk-ant-..."
tau config set providers.anthropic.thinking true
tau config set providers.anthropic.thinkingBudget 4096

# Gemini 同时识别 GOOGLE_API_KEY / GEMINI_API_KEY 环境变量
tau config set provider gemini
```

可配置字段白名单：`apiKey`、`baseUrl`、`host`、`model`、`timeoutMs`，以及思考旋钮（`thinking` / `thinkingEffort` / `thinkingBudget`，ollama 旧键 `think` 仍然兼容）。`DEFAULT_CONFIG.providers` 刻意不含任何默认模型——模型选择永远是你显式做的决定。

## 思考模式与思考强度（v0.6.2）

思考旋钮在三个 front door 上一致可选：CLI（`tau provider thinking`）、TUI（`/thinking`）、WebUI（设置面板）。归一化键：

- `providers.<name>.thinking` — `"on" | "off"`（读取兼容旧布尔 `true` / `false`）；
- `providers.<name>.thinkingEffort` — `"low" | "medium" | "high"`（思考强度）；
- `providers.<name>.thinkingBudget` — 显式 token 预算（anthropic/gemini），优先于 effort 预设。

每家 provider 支持的旋钮不同（UI 据能力矩阵渲染，不支持的不出现）：

| Provider  | 模式 on/off | 强度 low/medium/high | 显式预算 | 线格式映射                                                        |
| --------- | ----------- | -------------------- | -------- | ----------------------------------------------------------------- |
| anthropic | ✓           | ✓                    | ✓        | `thinking.enabled` + budget_tokens（effort 预设 2048/8192/16384） |
| gemini    | ✓           | ✓                    | ✓        | `thinkingBudget`（off→0；on 无预算→动态 −1；effort 同预设）       |
| openai    | –           | ✓                    | –        | `reasoning_effort`（仅显式设置时发送）                            |
| deepseek  | ✓           | –                    | –        | `thinking: {type: enabled/disabled}`（仅显式设置时发送）          |
| ollama    | ✓           | –                    | –        | `think: true/false`                                               |
| mock/zai  | –           | –                    | –        | 无思考旋钮                                                        |

所有旋钮都是 **opt-in**：一个都没配置时，请求体与过去字节级一致。

```bash
tau provider thinking anthropic          # 展示当前状态与支持的旋钮
tau provider thinking anthropic on high  # 扩展思考 + high 强度
tau provider thinking deepseek on        # thinking: enabled
tau provider thinking anthropic off      # 关闭
```

## 选择优先级

`--provider` 旗标 > `TAU_PROVIDER` 环境变量 > `config.provider`。未知名称会回退到 mock 并附说明——CLI 永远可用，但绝不静默假装连上了你要的 provider。

## 流式契约（v0.5.0）

`planStream` 是可选能力：缺失即回退缓冲 `plan()`，零行为变化。流式路径是"always-stream"设计——没有观察者时增量直接丢弃，即缓冲语义，单一 wire 路径服务两个入口。返回的计划仍要过与缓冲模式完全相同的严格 JSON 校验与确定性审查。

想接入一家新 provider？见[接入新 Provider](/reference/provider-dev)。
