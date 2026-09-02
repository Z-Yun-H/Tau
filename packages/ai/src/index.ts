/**
 * @tau/ai — pluggable AI provider layer: the planning prompt/contract, the
 * provider registry (mock/ollama/openai/deepseek/zai), the shared HTTP chat
 * helper + base HTTP provider used by real online providers, and the
 * API-key driven model catalog service. Providers propose plans; they never
 * execute anything.
 */
export * from "./prompt.js";
export * from "./registry.js";
export * from "./models.js";
export * from "./providers/http.js";
export * from "./providers/base.js";
export * from "./providers/mock.js";
export * from "./providers/ollama.js";
export * from "./providers/openai.js";
export * from "./providers/zai.js";
export * from "./providers/deepseek.js";
