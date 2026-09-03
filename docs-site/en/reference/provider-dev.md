# Adding a provider

`AIProvider` is the narrow seam between Tau and a model. Adding a provider = one new file + one registration + doc sync, without touching the pipeline.

## The interface contract

```ts
interface AIProvider {
  readonly name: string; // registry key
  readonly label: string; // CLI display name
  isAvailable(): Promise<boolean>;
  unavailableReason?(): string;
  plan(ctx: PlanningContext): Promise<Plan>; // required: planning
  listModels?(): Promise<ModelInfo[]>; // optional: model discovery
  reflect?(ctx: ReflectContext): Promise<AgentDecision>; // optional: reflection
  planStream?(ctx, onEvent?: ProviderStreamHandler): Promise<Plan>; // optional: streaming plan
  reflectStream?(ctx, onEvent?: ProviderStreamHandler): Promise<AgentDecision>; // optional: streaming reflect
}
```

Missing optional capabilities fall back automatically: no `planStream` → buffered `plan()`; no `reflectStream` → buffered `reflect()`; no `reflect` → single round. **A missing capability is never an error.**

## Implementation checklist

1. **Implement** `packages/ai/src/providers/<name>.ts`: pure `fetch` (the repo default is zero runtime deps; an SDK needs the optionalDependency + dynamic-import exemption process).
2. **Streaming** (if supported): add a consumer for your wire protocol in `packages/ai/src/chat-stream.ts` that folds into standard `ProviderStreamEvent`s; under "always-stream", one wire path serves both `plan()` and `planStream()`.
3. **Register** in `registerProviderBuiltins()` (`packages/ai/src/registry.ts`).
4. **Config** in `packages/core/src/config/store.ts`: `DEFAULT_CONFIG.providers` entry (**never a model default**), new fields into the `PROVIDER_FIELDS` whitelist.
5. **Tests**: see `anthropic-provider.test.ts` / `gemini-provider.test.ts` — wire assertions (auth headers, request bodies), parsing, stream event sequences, error paths.
6. **Docs**: both READMEs' provider table, `packages/ai/README.md`, the capability matrix in `AGENTS/ai-integration.md`, the docs-site [providers page](/en/guide/providers).

## Hard rules

- Usage field names differ per vendor (Anthropic uses `input_tokens`/`output_tokens`) — read the raw fields in the parser or map through the matching `normalizeUsage` shape; never assume OpenAI's shape.
- Thinking-mode constraints (e.g. omit temperature for Anthropic thinking) live inside the provider, never leak.
- Each provider degrades honestly: unsupported capabilities return an honest note, never a silent pretense.
