import fs from "node:fs";
import crypto from "node:crypto";
import { historyPath, ensureHome } from "./paths.js";
import type { HistoryEntry, HistoryKind, PlanStep } from "../types.js";

/** Append-only JSONL store for everything Tau runs. */
export function appendHistory(
  input: string,
  kind: HistoryKind,
  steps: PlanStep[],
  status: HistoryEntry["status"],
  extra?: { exitCode?: number; provider?: string },
): HistoryEntry {
  ensureHome();
  const entry: HistoryEntry = {
    id: crypto.randomUUID().slice(0, 8),
    ts: new Date().toISOString(),
    kind,
    input,
    steps,
    status,
    exitCode: extra?.exitCode,
    provider: extra?.provider,
  };
  fs.appendFileSync(historyPath(), JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export function readHistory(limit = 20): HistoryEntry[] {
  const file = historyPath();
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as HistoryEntry);
    } catch {
      // Skip corrupted lines instead of failing the whole command.
    }
  }
  return entries.slice(-limit).reverse();
}

export function findHistoryEntry(id: string): HistoryEntry | undefined {
  return readHistory(1000).find((entry) => entry.id === id || entry.id.startsWith(id));
}

export function clearHistory(): number {
  const file = historyPath();
  let count = 0;
  try {
    const raw = fs.readFileSync(file, "utf8");
    count = raw.split("\n").filter((line) => line.trim().length > 0).length;
    fs.rmSync(file, { force: true });
  } catch {
    // No history yet.
  }
  return count;
}
