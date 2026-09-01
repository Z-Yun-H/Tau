/**
 * Tau WebUI server — a zero-dependency local HTTP interface over the same
 * engine as the CLI: intent -> plan -> safety review -> user-approved
 * execution. Binds to 127.0.0.1 by default; nothing is ever executed by a
 * status/plan request alone. POST /api/execute re-reviews the plan inside
 * runPlan, refuses deny verdicts, and demands explicit confirmation for
 * high-risk plans — mirroring the CLI's gate, just over HTTP.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewPlan, runPlan } from "@tau/engine";
import type { Plan, SafetyReview } from "@tau/core";
import {
  ensureCatalog,
  getSessionInfo,
  listSkillSummaries,
  listToolSummaries,
  planAndReview,
  ProviderUnavailableError,
  readRecentHistory,
} from "@tau/agent";

const WEBUI_TIMEOUT_SEC = 120;
const BODY_CAP_BYTES = 1024 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/**
 * Locate the built client assets (dist/client from the vite client build);
 * fall back to the raw client/ sources so the API server can also serve a
 * page before the first build (and tests can exercise the static path).
 */
function resolveStaticDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      const pkgRoot = dir;
      for (const candidate of [
        path.join(pkgRoot, "dist", "client"),
        path.join(pkgRoot, "client"),
      ]) {
        if (fs.existsSync(path.join(candidate, "index.html"))) return candidate;
      }
      return pkgRoot;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), "dist", "client");
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_CAP_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          reject(new Error("JSON object body required"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function statusPayload(): Promise<Record<string, unknown>> {
  const info = await getSessionInfo();
  return {
    version: info.version,
    tauHome: info.tauHome,
    provider: {
      name: info.provider.name,
      label: info.provider.label,
      source: info.provider.source,
      model: info.provider.model,
    },
    providers: info.providers,
    skills: info.skillsCount,
    plugins: info.pluginsCount,
  };
}

/**
 * Shared body parsing for /api/execute and /api/execute/stream.
 * Returns an error message string, or the validated execute request.
 */
async function readExecuteRequest(
  req: http.IncomingMessage,
): Promise<string | { intent: string; plan: Plan; confirmHighRisk: boolean; provider?: string }> {
  const body = await readJsonBody(req);
  const intent = typeof body["intent"] === "string" ? body["intent"].trim() : "";
  const plan = body["plan"] as Plan | undefined;
  if (!intent || !plan || !Array.isArray(plan.steps)) {
    return "intent (string) and plan (with steps[]) are required";
  }
  return {
    intent,
    plan,
    confirmHighRisk: body["confirmHighRisk"] === true,
    provider: typeof body["provider"] === "string" ? body["provider"] : undefined,
  };
}

export function createRequestListener(): http.RequestListener {
  const staticDir = resolveStaticDir();
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      // ---- API ----
      if (url.pathname.startsWith("/api/")) {
        if (req.method === "GET" && url.pathname === "/api/status") {
          sendJson(res, 200, await statusPayload());
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/skills") {
          sendJson(res, 200, listSkillSummaries());
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/tools") {
          // Read-only tool-layer inventory (name/description/risk/owner/params —
          // never the executables). Built on demand like the planner does.
          sendJson(res, 200, listToolSummaries());
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/history") {
          // Optional ?limit= (default 20, hard cap 500) — the client-side
          // thread list replays more history when asked to.
          const raw = url.searchParams.get("limit");
          const parsed = raw === null ? Number.NaN : Number(raw);
          const limit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 20;
          sendJson(res, 200, readRecentHistory(limit));
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/plan") {
          const body = await readJsonBody(req);
          const intent = typeof body["intent"] === "string" ? body["intent"].trim() : "";
          if (!intent) {
            sendJson(res, 400, { error: "intent (string) is required" });
            return;
          }
          ensureCatalog();
          const planned = await planAndReview(intent);
          sendJson(res, 200, {
            intent,
            plan: planned.plan,
            review: planned.review,
            provider: planned.providerName,
            providerLabel: planned.providerLabel,
            warnings: planned.warnings,
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/execute") {
          const parsed = await readExecuteRequest(req);
          if (typeof parsed === "string") {
            sendJson(res, 400, { error: parsed });
            return;
          }
          const { intent, plan, confirmHighRisk, provider } = parsed;
          // Deterministic gate before the engine's own re-review inside runPlan.
          const review: SafetyReview = reviewPlan(plan);
          if (review.verdict === "deny") {
            sendJson(res, 403, { error: "plan denied by safety review", review });
            return;
          }
          if (review.overallRisk === "high" && !confirmHighRisk) {
            sendJson(res, 403, {
              error: "high-risk plan requires confirmHighRisk: true",
              review,
            });
            return;
          }
          // The HTTP request is the explicit user approval (the UI shows the
          // full plan + review first). runPlan re-reviews and still refuses
          // deny verdicts internally.
          const result = await runPlan(intent, plan, {
            provider,
            assumeYes: true,
            allowMediumAutoApprove: true,
            timeoutSec: WEBUI_TIMEOUT_SEC,
            autoApproveAll: true,
          });
          sendJson(res, 200, {
            status: result.status,
            output: result.output,
            outcomes: result.outcomes.map((outcome) => ({
              ok: outcome.ok,
              skipped: outcome.skipped === true,
              output: outcome.output,
            })),
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/execute/stream") {
          const parsed = await readExecuteRequest(req);
          if (typeof parsed === "string") {
            sendJson(res, 400, { error: parsed });
            return;
          }
          const { intent, plan, confirmHighRisk, provider } = parsed;
          // IDENTICAL deterministic gates — a streamed refusal is still a
          // refusal (plain JSON, not a stream).
          const review: SafetyReview = reviewPlan(plan);
          if (review.verdict === "deny") {
            sendJson(res, 403, { error: "plan denied by safety review", review });
            return;
          }
          if (review.overallRisk === "high" && !confirmHighRisk) {
            sendJson(res, 403, {
              error: "high-risk plan requires confirmHighRisk: true",
              review,
            });
            return;
          }
          res.writeHead(200, {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
          });
          const write = (event: unknown): void => {
            res.write(JSON.stringify(event) + "\n");
          };
          try {
            // runPlan re-reviews inside the engine (same as /api/execute);
            // onEvent mirrors the lifecycle events verbatim to the client.
            const result = await runPlan(intent, plan, {
              provider,
              assumeYes: true,
              allowMediumAutoApprove: true,
              timeoutSec: WEBUI_TIMEOUT_SEC,
              autoApproveAll: true,
              onEvent: (event) => write(event),
            });
            write({
              type: "result",
              status: result.status,
              output: result.output,
              outcomes: result.outcomes.map((outcome) => ({
                ok: outcome.ok,
                skipped: outcome.skipped === true,
                output: outcome.output,
              })),
            });
          } catch (error) {
            write({
              type: "error",
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            res.end();
          }
          return;
        }
        sendJson(res, 404, { error: `unknown API route: ${req.method} ${url.pathname}` });
        return;
      }

      // ---- static assets ----
      if (req.method !== "GET") {
        res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
        res.end("method not allowed");
        return;
      }
      const requested = url.pathname === "/" ? "/index.html" : url.pathname;
      const target = path.resolve(staticDir, "." + requested);
      if (!target.startsWith(staticDir + path.sep) || !fs.existsSync(target)) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      fs.createReadStream(target).pipe(res);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        sendJson(res, 503, { error: error.message });
        return;
      }
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

export interface StartWebUiOptions {
  /** Listen port (default 8787). */
  port?: number;
  /** Bind address (default 127.0.0.1 — never exposed to the network). */
  host?: string;
}

export interface RunningWebUi {
  url: string;
  server: http.Server;
  close: () => Promise<void>;
}

/** Start the WebUI server and resolve once it is listening. */
export async function startWebUi(options: StartWebUiOptions = {}): Promise<RunningWebUi> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 8787;
  const server = http.createServer(createRequestListener());
  await new Promise<void>((resolve) => {
    server.listen(requestedPort, host, resolve);
  });
  // Port 0 asks the OS for a free port — report the bound one, not the request.
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : requestedPort;
  return {
    url: `http://${host}:${port}/`,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
