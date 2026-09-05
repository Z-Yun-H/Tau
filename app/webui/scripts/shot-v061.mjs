/**
 * WebUI v0.6.1 feature captures — real server + real client in headless
 * Chromium, mirroring scripts/shot-v060.mjs's approach (mock provider,
 * TAU_HOME sandbox, offline). Saves PNGs for the v0.6.1 features under
 * docs/screenshots/:
 *
 *   provider-setup.png         U4 — provider picked, endpoint looked up
 *                              from the server catalog, key console linked
 *   provider-setup-key.png     U4 — pasted key masked (password dots), the
 *                              privacy default
 *   provider-setup-reveal.png  U4 — explicit peek: plaintext + "hide"
 *                              (the toggle re-masks itself after 8s)
 *   provider-setup-saved.png   U4 — after save: the server's sk-***last4
 *                              mask, the ·key chip, plaintext gone
 *   provider-setup-card.png    U4 — the setup section, element-cropped
 *   viewport-lock.png          U2 — fixed-height shell: a long thread
 *                              scrolls inside .stream-scroll while the
 *                              composer stays pinned; the page itself
 *                              never grows (scroll metrics on stdout)
 *
 * Every scene is real end-to-end — no stream interception: the provider
 * save goes through the actual POST /api/config/provider into the TAU_HOME
 * sandbox (0600 config), which is deleted afterwards. The demo key is
 * made-up and never leaves the machine.
 *
 * Run (from the repo root):
 *   pnpm install                      # playwright-core comes from the catalog
 *   pnpm --filter @tau/webui build    # the client must be built first
 *   pnpm --filter @tau/webui shots:v061
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startWebUi } from "../src/server.js";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/screenshots");
const ORIGINAL_CWD = process.cwd();
const DEMO_KEY = "sk-demo-4f9a2c7b8d1e3f60"; // made-up; lives only in the tmp sandbox

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
  return undefined;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-shots-v061-"));
process.env.TAU_HOME = path.join(tmp, "home");
fs.mkdirSync(process.env.TAU_HOME, { recursive: true });
fs.writeFileSync(
  path.join(tmp, "readme.md"),
  ["# demo workspace", "", "fixture workspace for the v0.6.1 shots", ""].join("\n"),
);
process.chdir(tmp);

const viewportEvidence = [];
const ui = await startWebUi({ port: 0 });
const browser = await chromium.launch({
  executablePath: resolveChromium(),
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });

  await page.goto(ui.url, { waitUntil: "networkidle" });
  await page.waitForSelector("textarea", { timeout: 15_000 });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const settle = async (ms = 350) => page.waitForTimeout(ms);

  // ---- U4: provider setup — pick → endpoint looked up → console linked ----
  await page.getByRole("button", { name: "open settings" }).click();
  await page.waitForSelector('[role="dialog"][aria-label="settings"]', { timeout: 10_000 });
  await settle(500); // let the /api/config fetch settle

  await page.locator(".provider-option").filter({ hasText: "deepseek" }).click();
  await page
    .locator(".setup-rows .row-value")
    .filter({ hasText: "api.deepseek.com" })
    .waitFor({ timeout: 5_000 });
  await page.locator(".console-link").filter({ hasText: "deepseek" }).waitFor({ timeout: 5_000 });
  await settle(400); // selection styling settle
  await page.screenshot({ path: path.join(OUT_DIR, "provider-setup.png") });

  // ---- U4: the pasted key is masked by default (password dots) ------------
  await page.fill(".key-input", DEMO_KEY);
  await page.waitForSelector('.key-input[type="password"]', { timeout: 5_000 });
  await settle(250);
  await page.screenshot({ path: path.join(OUT_DIR, "provider-setup-key.png") });

  // ---- U4: explicit peek — plaintext + "hide" (auto re-masks in 8s) -------
  await page.locator(".key-row button").filter({ hasText: "show" }).click();
  await page.waitForSelector('.key-input[type="text"]', { timeout: 5_000 });
  await settle(250);
  await page.screenshot({ path: path.join(OUT_DIR, "provider-setup-reveal.png") });

  // ---- U4: hide again, save — server mask + ·key chip, plaintext gone -----
  await page.locator(".key-row button").filter({ hasText: "hide" }).click();
  await page.waitForSelector('.key-input[type="password"]', { timeout: 5_000 });
  await page.locator(".save-row button").filter({ hasText: "save" }).click();
  await page.waitForSelector(".setup-ok", { timeout: 10_000 });
  await settle(600); // config refresh round-trip + chip flip
  await page.screenshot({ path: path.join(OUT_DIR, "provider-setup-saved.png") });

  await page
    .locator(".settings-section")
    .filter({ hasText: "provider setup" })
    .first()
    .screenshot({ path: path.join(OUT_DIR, "provider-setup-card.png") });

  // Restore the mock provider as active so the offline scenes below keep
  // running against the no-network demo backend (the deepseek save above
  // activated it — keyless mock switches back in one save).
  await page.locator(".provider-option").filter({ hasText: /^mock/ }).click();
  await page.locator(".save-row button").filter({ hasText: "save" }).click();
  await page.waitForSelector(".setup-ok", { timeout: 10_000 });
  await settle(600);

  // ---- U2: viewport lock — the page never grows with its content ----------
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"][aria-label="settings"]', {
    state: "detached",
    timeout: 5_000,
  });
  await page.keyboard.press("Alt+n"); // fresh thread for the long-conversation scene
  await settle(400);

  const prompts = [
    "scan the workspace and list what you find",
    "summarize the README for a newcomer",
    "plan a cleanup of the demo folder",
  ];
  for (const prompt of prompts) {
    await page.fill("textarea", prompt);
    await page.keyboard.press("Enter");
    await page.getByText("Run plan").last().waitFor({ timeout: 20_000 });
    await settle(400);
  }
  // Park at the top of the stream: earliest cards clipped by the fold, the
  // composer still pinned at the bottom — the shell is exactly one viewport.
  await page.evaluate(() => {
    document.querySelector(".stream-scroll")?.scrollTo({ top: 0, behavior: "instant" });
  });
  await settle(300);
  const lock = await page.evaluate(() => ({
    viewportInnerHeight: window.innerHeight,
    pageScrollHeight: document.documentElement.scrollHeight,
    pageCanScroll: document.documentElement.scrollHeight > window.innerHeight,
    streamScrollHeight: document.querySelector(".stream-scroll")?.scrollHeight ?? 0,
    streamClientHeight: document.querySelector(".stream-scroll")?.clientHeight ?? 0,
  }));
  viewportEvidence.push(lock);
  await page.screenshot({ path: path.join(OUT_DIR, "viewport-lock.png") });

  console.log(`shots written to ${OUT_DIR}`);
  console.log(`viewport-lock evidence: ${JSON.stringify(viewportEvidence, null, 2)}`);
  if (lock.pageCanScroll) {
    throw new Error("viewport lock broken: the page itself scrolls");
  }
  if (lock.streamScrollHeight <= lock.streamClientHeight) {
    throw new Error("stream does not overflow — the scene is not demonstrative");
  }
} finally {
  await browser.close();
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tmp, { recursive: true, force: true });
}
