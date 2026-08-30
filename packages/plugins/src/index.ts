/**
 * @tau/plugins — the MCP plugin system: plugin config CRUD, MCP connection
 * lifecycle, and tool bridging. Plugin tools always enter the safety gate as
 * medium risk; a failing server degrades to a warning, never a crash.
 */
export * from "./plugins/manager.js";
export * from "./plugins/mcp.js";
export * from "./plugins/runtime.js";
