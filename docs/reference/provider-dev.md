# 接入新 Provider

`AIProvider` 是 Tau 与模型之间的窄接口。接入一家新 provider = 一个新文件 + 一次注册 + 文档同步，不碰管线。

## 接口契约

```ts
interface AIProvider {
  readonly name: string; // 注册名（registry key）
  readonly label: string; // CLI 显示名
  isAvailable(): Promise<boolean>;
  unavailableReason?(): string;
  plan(ctx: PlanningContext): Promise<Plan>; // 必选：规划
  listModels?(): Promise<ModelInfo[]>; // 可选：模型发现
  reflect?(ctx: ReflectContext): Promise<AgentDecision>; // 可选：多轮反思
  planStream?(ctx, onEvent?: ProviderStreamHandler): Promise<Plan>; // 可选：流式规划
  reflectStream?(ctx, onEvent?: ProviderStreamHandler): Promise<AgentDecision>; // 可选：流式反思
}
```

所有可选能力缺失时自动回退：无 `planStream` 用缓冲 `plan()`，无 `reflectStream` 用缓冲 `reflect()`，无 `reflect` 降级单轮——**缺失永远不会是错误**。

## 实施清单

1. **实现** `packages/ai/src/providers/<name>.ts`：纯 `fetch`（仓库默认零运行时依赖；确需 SDK 走 optionalDependency + 动态 import 豁免申请）。
2. **流式**（如果支持）：把你的 wire 协议在 `packages/ai/src/chat-stream.ts` 里加一个消费者，折叠成标准 `ProviderStreamEvent`；"always-stream" 设计下单一 wire 路径同时服务 `plan()` 与 `planStream()`。
3. **注册** `packages/ai/src/registry.ts` 的 `registerProviderBuiltins()`。
4. **配置** `packages/core/src/config/store.ts`：`DEFAULT_CONFIG.providers` 加条目（**永不加默认模型**），新字段进 `PROVIDER_FIELDS` 白名单。
5. **测试**：参考 `anthropic-provider.test.ts` / `gemini-provider.test.ts`——wire 断言（认证头、请求体）、解析断言、流式事件序列、错误路径。
6. **文档**：双语 README 的 provider 表、`packages/ai/README.md`、`AGENTS/ai-integration.md` 的能力矩阵、文档站 [AI Provider](/guide/providers) 页。

## 硬规则

- usage 字段名各家不同（Anthropic 是 `input_tokens`/`output_tokens`）——解析器内直接读原始字段或走 `normalizeUsage` 的对应形状，不要假设 OpenAI 形状。
- thinking 模式的特殊约束（如 Anthropic thinking 下省略 temperature）写进 provider 内部，不外泄。
- 每家 provider 自己的诚实降级：不支持的能力返回诚实说明，不静默假装。
