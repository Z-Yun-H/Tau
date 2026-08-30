/**
 * Bundled asset locations — the skills/templates directories that ship with
 * the @tau/skills package. Resolution walks up from this module to the nearest
 * package.json so both source (tsx/vitest) and bundled (dist) layouts work.
 */

import path from "node:path";
import fs from "node:fs";

/** Directory of the @tau/skills package (where bundled skills/templates live). */
export function packageRoot(): string {
  const here = path.dirname(fileURLToPathSafe());
  let dir = here;
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function bundledSkillsDir(): string {
  return path.join(packageRoot(), "skills");
}

export function templatesDir(): string {
  return path.join(packageRoot(), "templates");
}

/** Minimal URL import so this module stays testable under vitest and tsx. */
function fileURLToPathSafe(): string {
  try {
    return new URL(import.meta.url).pathname;
  } catch {
    return process.cwd();
  }
}
