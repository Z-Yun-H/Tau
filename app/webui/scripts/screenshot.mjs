/**
 * WebUI run screenshots — boots the REAL server (`startWebUi`) against a
 * TAU_HOME sandbox with the mock provider, drives the REAL client in
 * headless Chromium (playwright-core), and saves the plan and streaming
 * result states as PNGs under `docs/screenshots/`.
 *
 * Regenerate (from the repo root):
 *   pnpm install                      # playwright-core comes from the catalog
 *   pnpm --filter @tau/webui build    # the client must be built first
 *   pnpm --filter @tau/webui shots
 *
 * Chromium resolution order: `$TAU_CHROMIUM` → newest `chromium-*` build in
 * `~/.cache/ms-playwright` → playwright-core's own registry default.
 * One-time browser install: `pnpm dlx playwright@1.57.0 install chromium`.
 * No network and no AI keys: the mock provider plans, the review gate is
 * the deterministic one users get in production.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startWebUi } from "../src/server.js";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/screenshots");

/** Resolve a Chromium executable without downloading anything. */
function resolveChromium() {
  if (process.env.TAU_CHROMIUM) return process.env.TAU_CHROMIUM;
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  if (fs.existsSync(cache)) {
    const builds = fs
      .readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const build of builds) {
      for (const entry of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium"]) {
        const candidate = path.join(cache, build, entry);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined; // fall through to playwright-core's registry default
}

const ORIGINAL_CWD = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-shots-"));
process.env.TAU_HOME = path.join(tmp, "home");
fs.mkdirSync(process.env.TAU_HOME, { recursive: true });
// The planned file.find runs against this working directory.
fs.writeFileSync(path.join(tmp, "readme.md"), "# demo workspace\n\nfor the screenshots\n");
fs.mkdirSync(path.join(tmp, "docs"));
fs.writeFileSync(path.join(tmp, "docs", "notes.md"), "- note one\n- note two\n");
process.chdir(tmp);

const ui = await startWebUi({ port: 0 });
const browser = await chromium.launch({
  executablePath: resolveChromium(),
  args: ["--no-sandbox"],
});
try {
  // Pin colorScheme: "dark" for the dark pass — headless Chromium defaults
  // to "light", and the theme boot script resolves 'system' via
  // prefers-color-scheme, so the unpinned dark screenshots would come out
  // light. Dark is the product's rendering baseline (DESIGN.md §3).
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  await page.goto(ui.url, { waitUntil: "networkidle" });
  await page.waitForSelector("textarea", { timeout: 15_000 });

  await page.fill("textarea", "find all *.md files");
  await page.keyboard.press("Enter");
  // The plan card renders the review verdict and the Run plan action.
  await page.getByText("Run plan").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600); // let shiki/code styling settle

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, "plan.png") });

  await page.getByText("Run plan").first().click();
  // The streaming result card carries the file.find output.
  await page.getByText("file.find in").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, "result.png") });

  // Switch the reference rail to the Tools tab so the catalog overview +
  // mutation/dry-run tags are captured too (AGENTS/collaboration.md §11:
  // app-layer changes require screenshot regeneration).
  await page.getByRole("tab", { name: "Tools" }).first().click();
  await page.waitForTimeout(400); // let the lazy tool list load + render
  await page.screenshot({ path: path.join(OUT_DIR, "tools.png") });

  // Settings panel (Ctrl+,) — the read-only config view (Issue #86).
  await page.keyboard.press("Control+,");
  await page.waitForSelector('[role="dialog"][aria-label="settings"]', { timeout: 10_000 });
  await page.waitForTimeout(500); // let the /api/config fetch settle
  await page.screenshot({ path: path.join(OUT_DIR, "settings.png") });
  await page.keyboard.press("Escape");

  // Light ramp pass — a fresh page with colorScheme: "light" exercises the
  // SAME 'system' resolution path the boot script uses (system → light),
  // so the shot doubles as a visual check of the no-flash boot behavior.
  // Alt+N starts a clean thread so the card state mirrors plan.png.
  const light = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  await light.goto(ui.url, { waitUntil: "networkidle" });
  await light.waitForSelector("textarea", { timeout: 15_000 });
  await light.keyboard.press("Alt+n");
  await light.fill("textarea", "find all *.md files");
  await light.keyboard.press("Enter");
  await light.getByText("Run plan").first().waitFor({ timeout: 20_000 });
  await light.waitForTimeout(600); // let shiki/code styling settle
  await light.screenshot({ path: path.join(OUT_DIR, "plan-light.png") });
  await light.close();

  console.log(`screenshots written to ${OUT_DIR}`);
} finally {
  await browser.close();
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tmp, { recursive: true, force: true });
}
