/**
 * @tau/agent — orchestration shared by Tau's UIs (CLI ask, TUI, WebUI):
 * assembles the full tool catalog (core tools + skill tools + MCP plugins)
 * and turns a natural-language intent into a reviewed, provider-proposed plan.
 */
export * from "./skill-tools.js";
export * from "./pipeline.js";
