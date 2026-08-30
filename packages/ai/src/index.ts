/**
 * @tau/ai — pluggable AI provider layer: the planning prompt/contract, the
 * provider registry (mock/ollama/openai/deepseek/zai), and the API-key driven
 * model catalog service. Providers propose plans; they never execute anything.
 */
export * from "./ai/prompt.js";
export * from "./ai/registry.js";
export * from "./ai/models.js";
export * from "./ai/providers/mock.js";
export * from "./ai/providers/ollama.js";
export * from "./ai/providers/openai.js";
export * from "./ai/providers/zai.js";
export * from "./ai/providers/deepseek.js";
