/**
 * Runtime path resolution — TAU_HOME override, config/history/skills
 * locations, and first-run directory bootstrap. All IO funnels through here
 * so tests can relocate the entire data home via one env var.
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Path resolution for Tau's runtime data.
 *
 * Precedence for the Tau home directory:
 *   1. $TAU_HOME (used by tests and dev containers)
 *   2. $XDG_STATE_HOME/tau  (Linux convention, when set)
 *   3. ~/.tau
 */
export function tauHome(): string {
  const fromEnv = process.env.TAU_HOME;
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg && xdg.trim().length > 0) {
    return path.join(path.resolve(xdg), "tau");
  }
  return path.join(os.homedir(), ".tau");
}

export function configPath(): string {
  return path.join(tauHome(), "config.json");
}

export function historyPath(): string {
  return path.join(tauHome(), "history.jsonl");
}

export function userSkillsDir(): string {
  return path.join(tauHome(), "skills");
}

export function ensureHome(): string {
  const home = tauHome();
  fs.mkdirSync(home, { recursive: true });
  return home;
}
