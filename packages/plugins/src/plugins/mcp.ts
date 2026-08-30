/**
 * MCP transport layer — optional-SDK loader (variable-specifier import,
 * injectable for tests), client handshake, tool listing/calling with strict
 * budgets (10s connect / 120s call / 64KB args), JSON-schema mapping and
 * tool-name sanitization into the plugin.<server>.<tool> namespace.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ToolDefinition, ToolParamSpec } from "@tau/core";
import type { PluginConfig } from "@tau/core";

/**
 * MCP (Model Context Protocol) client seam.
 *
 * The SDK is an optionalDependency: it is dynamically imported through
 * variable specifiers (never statically bundled — see tsdown.config.ts
 * deps.neverBundle) so Tau keeps working when it is absent; the plugin
 * features then degrade with a clear warning instead of crashing.
 *
 * Types are imported type-only, which the compiler erases — safe even when
 * the package is not installed at runtime.
 */

export const MCP_SDK_MISSING =
  'Optional package "@modelcontextprotocol/sdk" is not installed — MCP plugins are disabled. Install it with: npm i @modelcontextprotocol/sdk';

/** Budget for the initialize handshake per plugin (ms). */
const CONNECT_TIMEOUT_MS = 10_000;
/** Upper bound for one tool call through a plugin (ms). */
const CALL_TIMEOUT_MS = 120_000;
/** Largest JSON arguments payload we forward to a plugin tool (bytes). */
export const MAX_PLUGIN_ARGS_BYTES = 64 * 1024;

/** Structural subset of the SDK surface Tau relies on. */
interface SdkBundle {
  Client: new (info: { name: string; version: string }) => Client;
  StdioClientTransport: new (options: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    stderr?: "ignore" | "inherit";
  }) => Transport;
  StreamableHTTPClientTransport: new (
    url: URL | string,
    options?: { requestInit?: { headers?: Record<string, string> } },
  ) => Transport;
}

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: McpJsonSchema;
}

export interface McpJsonSchema {
  type?: string;
  properties?: Record<string, McpPropertySchema>;
  required?: string[];
}

interface McpPropertySchema {
  type?: string;
  description?: string;
  default?: unknown;
}

interface McpContentPart {
  type?: string;
  text?: string;
}

interface McpCallResult {
  content?: McpContentPart[];
  isError?: boolean;
}

let cachedSdk: SdkBundle | null | undefined;

/** Load the MCP SDK dynamically; null when absent (never throws). */
export async function loadMcpSdk(): Promise<SdkBundle | null> {
  if (cachedSdk !== undefined) return cachedSdk;
  try {
    // Variable specifiers on purpose: bundlers cannot resolve them, so the
    // SDK stays external and is resolved from node_modules at runtime.
    const clientSpec = "@modelcontextprotocol/sdk/client/index.js";
    const stdioSpec = "@modelcontextprotocol/sdk/client/stdio.js";
    const httpSpec = "@modelcontextprotocol/sdk/client/streamableHttp.js";
    const [client, stdio, http] = (await Promise.all([
      import(clientSpec),
      import(stdioSpec),
      import(httpSpec),
    ])) as unknown as [
      { Client: SdkBundle["Client"] },
      { StdioClientTransport: SdkBundle["StdioClientTransport"] },
      { StreamableHTTPClientTransport: SdkBundle["StreamableHTTPClientTransport"] },
    ];
    if (typeof client.Client !== "function") throw new Error("unexpected SDK shape");
    cachedSdk = {
      Client: client.Client,
      StdioClientTransport: stdio.StdioClientTransport,
      StreamableHTTPClientTransport: http.StreamableHTTPClientTransport,
    };
  } catch {
    cachedSdk = null;
  }
  return cachedSdk;
}

export function resetMcpSdkCache(): void {
  cachedSdk = undefined;
}

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
    },
  };
}

/** Build a client + transport for one plugin and complete the MCP handshake. */
export async function connectPluginClient(sdk: SdkBundle, plugin: PluginConfig): Promise<Client> {
  let transport: Transport;
  if (plugin.transport === "stdio") {
    transport = new sdk.StdioClientTransport({
      command: plugin.command ?? "",
      args: plugin.args ?? [],
      // extras are layered over the SDK's safe default env allowlist
      env: plugin.env,
      cwd: plugin.cwd,
      stderr: "ignore",
    });
  } else {
    transport = new sdk.StreamableHTTPClientTransport(plugin.url ?? "", {
      requestInit: plugin.headers ? { headers: plugin.headers } : undefined,
    });
  }
  try {
    return await handshake(sdk, transport);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} (transport: ${plugin.transport})`);
  }
}

/** Complete the MCP initialize handshake over a ready transport.
 *  Exported so tests can drive it with an InMemoryTransport pair. */
export async function handshake(sdk: SdkBundle, transport: Transport): Promise<Client> {
  const client = new sdk.Client({ name: "tau", version: "0.1.0" });
  const { signal, cancel } = timeoutSignal(CONNECT_TIMEOUT_MS);
  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () =>
          reject(new Error(`connect timed out after ${CONNECT_TIMEOUT_MS / 1000}s`)),
        );
      }),
    ]);
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  } finally {
    cancel();
  }
  return client;
}

/** List the tools a connected plugin server exposes. */
export async function listMcpTools(client: Client): Promise<McpToolInfo[]> {
  const result = (await client.listTools()) as { tools?: McpToolInfo[] };
  return result.tools ?? [];
}

/** Render MCP tool result content as plain text (Tau's tool output format). */
export function mcpResultToText(result: McpCallResult): string {
  const parts = result.content ?? [];
  if (parts.length === 0) return "(empty result)";
  return parts
    .map((part) => {
      if (typeof part.text === "string") return part.text;
      if (part.type === "image") return "(image content omitted)";
      if (part.type === "audio") return "(audio content omitted)";
      return `(${part.type ?? "unknown"} content)`;
    })
    .join("\n")
    .trim();
}

/** Call one tool on a connected plugin server. Throws on isError results. */
export async function callMcpTool(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const payload = JSON.stringify(args ?? {});
  if (payload.length > MAX_PLUGIN_ARGS_BYTES) {
    throw new Error(
      `arguments exceed ${Math.floor(MAX_PLUGIN_ARGS_BYTES / 1024)}KB cap — refusing to send to plugin tool`,
    );
  }
  const { signal, cancel } = timeoutSignal(CALL_TIMEOUT_MS);
  try {
    const result = (await Promise.race([
      client.callTool({ name: toolName, arguments: args ?? {} }),
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () =>
          reject(new Error(`tool call timed out after ${CALL_TIMEOUT_MS / 1000}ms`)),
        );
      }),
    ])) as McpCallResult;
    const text = mcpResultToText(result);
    if (result.isError) throw new Error(text || "plugin tool reported an error");
    return text;
  } finally {
    cancel();
  }
}

/** Map a JSON-schema property to Tau's simple param spec type. */
export function jsonTypeToParamType(prop: McpPropertySchema): ToolParamSpec["type"] {
  switch (prop.type) {
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "string[]";
    default:
      // objects and untyped/complex schemas are passed as JSON strings
      return "string";
  }
}

function sanitizeToolName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "tool";
}

/**
 * Convert MCP tool descriptors into Tau ToolDefinitions.
 * Plugin tools are ALWAYS medium risk: they are third-party code the
 * reviewer treats like any mutating operation (interactive confirm, --yes
 * honors allowMediumAutoApprove, high/blocked semantics unchanged).
 */
export function mcpToolsToDefinitions(
  plugin: PluginConfig,
  tools: McpToolInfo[],
): ToolDefinition[] {
  const used = new Set<string>();
  return tools.map((tool) => {
    let local = sanitizeToolName(tool.name);
    let n = 2;
    while (used.has(local)) local = `${sanitizeToolName(tool.name)}-${n++}`;
    used.add(local);

    const schema = tool.inputSchema ?? {};
    const required = new Set(schema.required ?? []);
    const properties = schema.properties ?? {};
    const params: ToolParamSpec[] = Object.entries(properties).map(([pname, prop]) => ({
      name: pname,
      type: jsonTypeToParamType(prop),
      description: prop.description ?? "",
      required: required.has(pname),
      default: prop.default,
    }));

    const fullName = `plugin.${plugin.name}.${local}`;
    const description = `[plugin:${plugin.name}] ${tool.description ?? tool.name}`;
    return {
      name: fullName,
      description,
      params,
      risk: "medium",
      owner: `plugin:${plugin.name}`,
      run: async (args: Record<string, unknown>) => {
        const sdk = await loadMcpSdk();
        if (!sdk) throw new Error(MCP_SDK_MISSING);
        const client = await connectPluginClient(sdk, plugin);
        try {
          const text = await callMcpTool(client, tool.name, args);
          return { text, data: { plugin: plugin.name, tool: tool.name } };
        } finally {
          await client.close().catch(() => {});
        }
      },
    } satisfies ToolDefinition;
  });
}
