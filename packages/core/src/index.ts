/**
 * @tau/core — Tau's foundation layer: domain types, config store and history,
 * runtime path resolution. Zero runtime dependencies by design; every other
 * Tau package builds on top of these primitives.
 */
export * from "./types.js";
export * from "./config/paths.js";
export * from "./config/store.js";
export * from "./config/history.js";
