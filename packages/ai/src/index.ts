/**
 * @tau/ai — pluggable AI provider layer: the planning prompt/contract, the
 * provider registry (mock/ollama/openai/deepseek/zai/anthropic/gemini), the
 * shared HTTP chat helper + base HTTP provider used by real online providers,
 * the unified streaming wire layer (v0.5.0), and the API-key driven model
 * catalog service. Providers propose plans; they never execute anything.
 */
export * from "./prompt.js";
export * from "./reflect.js";
export * from "./usage.js";
export * from "./chat-stream.js";
export * from "./registry.js";
export * from "./models.js";
export * from "./thinking.js";
export * from "./providers/http.js";
export * from "./providers/base.js";
export * from "./providers/mock.js";
export * from "./providers/ollama.js";
export * from "./providers/openai.js";
export * from "./providers/zai.js";
export * from "./providers/deepseek.js";
export * from "./providers/anthropic.js";
export * from "./providers/gemini.js";
