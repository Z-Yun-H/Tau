/**
 * Presentation formatters — pure functions, no DOM. Data renders in mono;
 * prose renders in sans; timestamps degrade honestly (relative when recent,
 * absolute otherwise, full ISO in the tooltip).
 */

/** Plan args as `key="value"` pairs — what the step will actually do. */
export function formatArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  return Object.entries(args)
    .map(([key, value]) => {
      if (value === undefined) return key;
      if (typeof value === "string") {
        return value.includes(" ") || value.includes('"')
          ? `${key}="${value.replace(/"/g, '\\"')}"`
          : `${key}=${value}`;
      }
      return `${key}=${JSON.stringify(value)}`;
    })
    .join("  ");
}

/** "just now" → "42s" → "5m" → "3h" → "6d" → then the date itself. */
export function relTime(ts: string, now = Date.now()): string {
  const then = Date.parse(ts);
  if (Number.isNaN(then)) return ts;
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** Locale datetime for tooltips / absolute display. */
export function absTime(ts: string): string {
  const then = Date.parse(ts);
  if (Number.isNaN(then)) return ts;
  return new Date(then).toLocaleString();
}

/** Tool family prefix ("file" of "file.find"), or "" for shell/unprefixed. */
export function toolFamily(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? "" : name.slice(0, dot);
}

export interface ToolGroup {
  family: string;
  tools: {
    name: string;
    description: string;
    risk: string;
    owner: string;
    params: { name: string; type: string; required: boolean }[];
  }[];
}

/** Group tools by their dotted family, registry order preserved. */
export function groupTools(
  tools: {
    name: string;
    description: string;
    risk: string;
    owner: string;
    params: { name: string; type: string; required: boolean }[];
  }[],
): ToolGroup[] {
  const groups = new Map<string, ToolGroup>();
  for (const tool of tools) {
    const family = toolFamily(tool.name) || "other";
    let group = groups.get(family);
    if (!group) {
      group = { family, tools: [] };
      groups.set(family, group);
    }
    group.tools.push(tool);
  }
  return [...groups.values()];
}
