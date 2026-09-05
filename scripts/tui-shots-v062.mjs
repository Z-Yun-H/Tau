#!/usr/bin/env node
/**
 * tui-shots-v062.mjs — TUI captures for the v0.6.2 model & thinking
 * selection (issue #165), following the committed process in
 * app/tui/docs/screenshots/README.md: the BUILT TUI in a real pty
 * (script(1)), staggered scripted keystrokes, TAU_HOME sandbox, offline.
 *
 *   model-picker.svg  /model — the catalog picker over the mock
 *                     provider's deterministic offline catalog
 *                     (mock-chat / mock-reasoner), frozen mid-overlay
 *                     (SIGTERM flush, v0.6.0 palette pattern)
 *   model-picked.svg  the picker resolved by Enter — "Model set to
 *                     mock-chat." (persisted to the sandbox config)
 *   thinking.svg      /thinking + /provider — the honest capability
 *                     answer on the knob-less mock and the model +
 *                     thinking state lines
 *
 * Keystroke mechanics (empirical, deterministic): typing "/" alone opens
 * the live command palette; typing the rest of the command CHAR-BY-CHAR
 * filters it. When the typed line is an exact command (a prefix of the
 * usage), Enter INSERTS the usage — so arg-less commands dispatch with
 * one more Enter, while commands with an argsHint get the placeholder
 * stripped by backspaces first. A non-prefix line (e.g. "/thinking on
 * high") has no palette match, and Enter dismisses the palette back
 * into the readline buffer, preserving the text — one more Enter
 * dispatches it. A bare LF never submits a readline line; CR does.
 *
 * Run: node scripts/tui-shots-v062.mjs (from the repo root, after
 * pnpm build). Writes SVGs into app/tui/docs/screenshots/.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = process.cwd();
const OUT = path.join(REPO, "app/tui/docs/screenshots");
const TUI = path.join(REPO, "app/tui/dist/index.js");
const RENDER = path.join(REPO, "scripts/screenshot/term-svg.mjs");

if (!fs.existsSync(TUI)) {
  console.error("built TUI not found — run `pnpm build` first");
  process.exit(1);
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "tau-tui-shots-v062-"));
const tauHome = path.join(home, "home");
fs.mkdirSync(tauHome, { recursive: true });
const env = {
  ...process.env,
  TAU_HOME: tauHome,
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
};

fs.mkdirSync(OUT, { recursive: true });

/** Typing helpers — every char its own write (the takeover races bursts). */
const TYPE_MS = 90;
function typeChars(steps, text, delay = TYPE_MS) {
  for (const ch of text) steps.push([delay, ch]);
}
/** Strip n chars after a palette insert (char-by-char backspaces). */
function backspace(steps, n) {
  for (let i = 0; i < n; i++) steps.push([TYPE_MS, "\x7f"]);
}
/** A slash command via the palette: "/" + name + Enter(insert). */
function paletteCommand(steps, name, { strip = 0, args = "", trailing = "dispatch" } = {}) {
  steps.push([1_400, "/"]);
  steps.push([1_100, ""]);
  typeChars(steps, name);
  steps.push([700, "\r"]); // insert the usage into the readline buffer
  if (strip > 0) backspace(steps, strip);
  if (args) typeChars(steps, args);
  if (trailing === "dispatch") steps.push([700, "\r"]);
}
/** A non-prefix line: the palette dismisses and keeps the buffer. */
function paletteFreeLine(steps, line) {
  steps.push([1_400, "/"]);
  steps.push([1_100, ""]);
  typeChars(steps, line);
  steps.push([700, "\r"]); // no match → dismiss, text back in the buffer
  steps.push([700, "\r"]); // dispatch
}

/** Write the keystroke driver (feeds stdout with delays, EPIPE-safe). */
function writeDriver(steps, holdMs, driverFile) {
  const body = `process.stdout.on("error", () => process.exit(0));
const T = ${JSON.stringify(steps)};
let i = 0;
function n(){if(i>=T.length){setTimeout(()=>process.exit(0),${holdMs});return}const[d,t]=T[i++];setTimeout(()=>{process.stdout.write(t);n()},d)}
n();
`;
  fs.writeFileSync(driverFile, body);
}

/**
 * Run one scripted pty session — the driver pipes INTO script(1) (its
 * stdin is relayed into the pty), the committed capture process.
 * `hold`: the pipeline is backgrounded and the TUI SIGTERMed after
 * holdMs — script(1) flushes the capture cleanly (EOF would dismiss the
 * overlay first).
 */
function capture(steps, captureFile, { hold = false, holdMs = 4_000 } = {}) {
  const driverFile = path.join(home, `driver-${path.basename(captureFile)}.mjs`);
  writeDriver(steps, holdMs, driverFile);
  const pipeline = hold
    ? `node ${driverFile} | script -qec "node ${TUI}" ${captureFile} & bg=$!; ` +
      `sleep ${Math.round(holdMs / 1000)}; ` +
      `pkill -TERM -f "node ${TUI}" >/dev/null 2>&1 || true; wait $bg; exit 0`
    : `node ${driverFile} | script -qec "node ${TUI}" ${captureFile}`;
  const result = spawnSync("bash", ["-c", pipeline], {
    timeout: 90_000,
    env,
    encoding: "utf8",
  });
  const captured = fs.existsSync(captureFile) && fs.statSync(captureFile).size > 1_000;
  if (!captured) {
    throw new Error(`capture produced no data (${result.status}): ${result.stderr}`);
  }
}

function render(captureFile, title, outFile, minCols = 96) {
  const svg = execFileSync(
    "node",
    [RENDER, captureFile, "--title", title, "--min-cols", String(minCols)],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  fs.writeFileSync(path.join(OUT, outFile), svg);
  console.log(`wrote ${outFile} (${svg.length} bytes)`);
}

// ---- 1: /model picker — frozen mid-overlay (SIGTERM flush) ----
const capPicker = path.join(home, "picker.raw");
{
  const steps = [];
  paletteCommand(steps, "model", { strip: 9 }); // strip " [model] "
  steps.push([3_000, ""]); // the picker is open here
  // holdMs must cover the whole palette dance (~5s) plus a viewing window.
  capture(steps, capPicker, { hold: true, holdMs: 9_000 });
}
render(capPicker, "tau tui — /model: pick from the provider's live catalog", "model-picker.svg");

// ---- 2: /model + Enter — "Model set to mock-chat." ----
{
  const steps = [];
  paletteCommand(steps, "model", { strip: 9 });
  steps.push([1_800, "\r"]); // Enter selects the highlighted model
  paletteCommand(steps, "exit");
  capture(steps, path.join(home, "picked.raw"));
}
render(path.join(home, "picked.raw"), "tau tui — /model: Enter sets the model", "model-picked.svg");

// ---- 3: /thinking + /provider — honest capability answer + state ----
{
  const steps = [];
  paletteFreeLine(steps, "thinking on high"); // non-prefix → dismiss + dispatch
  steps.push([1_500, ""]);
  paletteCommand(steps, "provider");
  steps.push([1_500, ""]);
  paletteCommand(steps, "exit");
  capture(steps, path.join(home, "thinking.raw"));
}
render(
  path.join(home, "thinking.raw"),
  "tau tui — /thinking: honest capability answer + /provider state lines",
  "thinking.svg",
);

fs.rmSync(home, { recursive: true, force: true });
console.log("done");
