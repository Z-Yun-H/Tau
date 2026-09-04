/**
 * Tau WebUI server — a zero-dependency local HTTP interface over the same
 * engine as the CLI: intent -> plan -> safety review -> user-approved
 * execution. Binds to 127.0.0.1 by default; nothing is ever executed by a
 * status/plan request alone. POST /api/execute re-reviews the plan inside
 * runPlan, refuses deny verdicts, and demands explicit confirmation for
 * high-risk plans — mirroring the CLI's gate, just over HTTP. The streaming
 * routes (/api/plan/stream, /api/execute/stream, /api/goal/stream) relay
 * provider thinking and step output as NDJSON; every refusal happens before
 * the stream starts, as plain JSON.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewPlan, runPlan } from "@tau/engine";
import {
  loadConfig,
  redactConfig,
  type ImageAttachment,
  type Plan,
  type PriorTurn,
  type SafetyReview,
} from "@tau/core";
import { cachedModels, formatUsage } from "@tau/ai";
import { probeImageHeader } from "@tau/ui";
import {
  ensureCatalog,
  getSessionInfo,
  listSkillSummaries,
  listToolSummaries,
  planAndReview,
  planAndReviewStream,
  ProviderUnavailableError,
  readRecentHistory,
  runGoal,
  slashCommandsFor,
} from "@tau/agent";
import { GoalRegistry } from "./goal.js";

const WEBUI_TIMEOUT_SEC = 120;
/**
 * Request-body cap. Raised from 1 MiB for the image-attachment flow
 * (issue #135): up to 4 images x ~5.4 MiB base64 plus JSON overhead. The
 * attachment payloads carry their own strict limits in readAttachments()
 * (whitelist, count, per-image and total size) — this cap only bounds the
 * raw HTTP body; the server binds to 127.0.0.1 so the exposure stays local.
 */
const BODY_CAP_BYTES = 24 * 1024 * 1024;
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

/**
 * Sanitize the client-provided conversation history (conversation mode,
 * issue #134): last 12 turns, roles whitelist, text trimmed and capped.
 * Malformed entries are skipped, never fatal. Undefined when nothing
 * usable remains — callers then behave exactly as before.
 */
function readPriorTurns(body: Record<string, unknown>): PriorTurn[] | undefined {
  const raw = body["history"];
  if (!Array.isArray(raw)) return undefined;
  const turns: PriorTurn[] = [];
  for (const entry of raw.slice(-12)) {
    if (typeof entry !== "object" || entry === null) continue;
    const role = (entry as { role?: unknown }).role;
    const text = (entry as { text?: unknown }).text;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") continue;
    const clean = text.trim().slice(0, 4000);
    if (!clean) continue;
    turns.push({ role, text: clean });
  }
  return turns.length > 0 ? turns : undefined;
}

/** ---- Image attachments (image parsing module, issue #135) ---- */

/** Accepted image media types — everything else is rejected up front. */
const ATTACHMENT_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
/** Max images per request. */
const MAX_ATTACHMENTS = 4;
/** Max base64 length per image (~4.2 MiB decoded, matching the 4 MiB raw client cap). */
const MAX_ATTACHMENT_BASE64 = 5_600_000;
/** Max combined base64 across all attachments of one request. */
const MAX_ATTACHMENTS_BASE64_TOTAL = 22_000_000;
/** Max display-name length (names are annotation/UI material, never payloads). */
const MAX_ATTACHMENT_NAME = 120;

/** mediaType -> the magic-number signature prefix probeImageHeader reports. */
const EXPECTED_FORMAT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Result of {@link readAttachments}: either a validated attachment list or
 * an explicit error message. Unlike conversation history (silently
 * sanitized), attachment problems REJECT the request with 4xx — a
 * silently-dropped multi-megabyte payload would look like the AI ignored
 * the user's image, and a mangled one must never reach a provider.
 */
export type AttachmentsResult =
  | { error: string; attachments?: undefined }
  | { attachments: ImageAttachment[]; error?: undefined };

/** Strict base64 shape: charset + length multiple of 4. */
function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

/**
 * Validate + normalize the client-provided `attachments` array (issue
 * #135): image kind, whitelisted media type, decodable base64 within the
 * size caps, and a magic-number probe whose detected format must MATCH the
 * claimed media type (a renamed .exe can never masquerade as image/png).
 * Returns the first violation as an explicit error string (callers answer
 * 400), or the cleaned attachment list.
 */
export function readAttachments(body: Record<string, unknown>): AttachmentsResult {
  const raw = body["attachments"];
  if (raw === undefined || raw === null) return { attachments: [] };
  if (!Array.isArray(raw)) return { error: "attachments (array) is required when present" };
  if (raw.length === 0) return { attachments: [] };
  if (raw.length > MAX_ATTACHMENTS) {
    return { error: `too many attachments (max ${MAX_ATTACHMENTS})` };
  }
  const attachments: ImageAttachment[] = [];
  let total = 0;
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { error: `attachment ${i + 1}: object required` };
    }
    const item = entry as Record<string, unknown>;
    if (item["kind"] !== "image") {
      return { error: `attachment ${i + 1}: unsupported kind (only "image" is accepted)` };
    }
    const mediaType = typeof item["mediaType"] === "string" ? item["mediaType"].toLowerCase() : "";
    if (!ATTACHMENT_MEDIA_TYPES.has(mediaType)) {
      return {
        error:
          `attachment ${i + 1}: unsupported mediaType "${mediaType || "(missing)"}" ` +
          `(accepted: png, jpeg, webp, gif)`,
      };
    }
    const data = typeof item["dataBase64"] === "string" ? item["dataBase64"] : "";
    if (!data) return { error: `attachment ${i + 1}: dataBase64 (string) is required` };
    if (data.length > MAX_ATTACHMENT_BASE64) {
      return {
        error: `attachment ${i + 1}: image too large (max ~4 MB after base64)`,
      };
    }
    if (!isBase64(data)) {
      return { error: `attachment ${i + 1}: dataBase64 is not valid base64` };
    }
    total += data.length;
    if (total > MAX_ATTACHMENTS_BASE64_TOTAL) {
      return { error: `attachments too large in total (max ~16 MB decoded)` };
    }
    let name: string | undefined;
    if (item["name"] !== undefined) {
      if (typeof item["name"] !== "string") {
        return { error: `attachment ${i + 1}: name must be a string when present` };
      }
      const trimmed = item["name"].trim();
      if (trimmed) name = trimmed.slice(0, MAX_ATTACHMENT_NAME);
    }
    // Magic-number gate: the header must decode to the claimed format —
    // reuses @tau/ui's in-house fixed-offset parser (the same one behind
    // the TUI's /view), keeping the audit-clean dependency story.
    const probe = probeImageHeader(Buffer.from(data, "base64"));
    if (probe.format !== EXPECTED_FORMAT[mediaType]) {
      return {
        error: `attachment ${i + 1}: content does not look like ${mediaType.replace("image/", "")}`,
      };
    }
    attachments.push({ kind: "image", mediaType, dataBase64: data, ...(name ? { name } : {}) });
  }
  return { attachments };
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
 * Read-only settings surface for the WebUI settings panel. The `config`
 * field is the EFFECTIVE config exactly as `tau config list` prints it —
 * through the same `redactConfig` (every `providers.<name>.apiKey` masked,
 * never plaintext) — plus live provider availability and the active
 * provider's model-catalog cache state. Deliberately GET-only: config
 * modification stays in the CLI (`tau config set …`), so the browser never
 * becomes a second write path into the safety-relevant configuration.
 */
async function configPayload(): Promise<Record<string, unknown>> {
  const info = await getSessionInfo();
  const catalog = cachedModels(info.provider.name);
  return {
    version: info.version,
    tauHome: info.tauHome,
    config: redactConfig(loadConfig()),
    provider: {
      name: info.provider.name,
      label: info.provider.label,
      source: info.provider.source,
      model: info.provider.model,
    },
    providers: info.providers,
    modelCatalog: {
      count: catalog.models.length,
      ...(catalog.refreshedAt ? { refreshedAt: catalog.refreshedAt } : {}),
    },
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

export interface RequestListenerOptions {
  /**
   * Request log sink (v0.4.0 observability, issue #98). Default: one line
   * per request to stderr — `ts method path -> status ms [note]` — disabled
   * by `TAU_WEBUI_QUIET=1`. Inject a function in tests (or to forward to
   * your own logger); the server itself never writes to stdout files.
   */
  log?: (line: string) => void;
}

export function createRequestListener(options: RequestListenerOptions = {}): http.RequestListener {
  const staticDir = resolveStaticDir();
  const goalRegistry = new GoalRegistry();
  // Injection wins; `TAU_WEBUI_QUIET=1` silences the DEFAULT stderr sink
  // only (tests inject a collecting logger and stay in control).
  const defaultQuiet = process.env["TAU_WEBUI_QUIET"] === "1";
  const log =
    options.log ??
    (defaultQuiet ? (): void => {} : (line: string): void => void console.error(line));
  // Handlers can annotate a response (e.g. token usage of the AI call it
  // triggered); the finish hook appends the note to the log line.
  const notes = new WeakMap<http.ServerResponse, string>();
  return async (req, res) => {
    const startedAt = Date.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    res.on("finish", () => {
      const ms = Date.now() - startedAt;
      const note = notes.get(res);
      log(
        `${new Date().toISOString()} ${req.method} ${url.pathname} -> ${res.statusCode} ${ms}ms${note ? ` ${note}` : ""}`,
      );
    });
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
        if (req.method === "GET" && url.pathname === "/api/commands") {
          // Slash-command metadata for the composer menu — the same shared
          // catalog the TUI palette reads, webui surface. Pure data: names,
          // aliases, descriptions; execution stays client-side.
          sendJson(res, 200, { commands: slashCommandsFor("webui") });
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
        if (req.method === "GET" && url.pathname === "/api/config") {
          sendJson(res, 200, await configPayload());
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/plan") {
          const body = await readJsonBody(req);
          const intent = typeof body["intent"] === "string" ? body["intent"].trim() : "";
          if (!intent) {
            sendJson(res, 400, { error: "intent (string) is required" });
            return;
          }
          const attachments = readAttachments(body);
          if (attachments.error !== undefined) {
            sendJson(res, 400, { error: attachments.error });
            return;
          }
          ensureCatalog();
          const planned = await planAndReview(intent, { attachments: attachments.attachments });
          if (planned.usage) notes.set(res, formatUsage(planned.usage));
          sendJson(res, 200, {
            intent,
            plan: planned.plan,
            review: planned.review,
            provider: planned.providerName,
            providerLabel: planned.providerLabel,
            warnings: planned.warnings,
            // v0.4.0 observability: the planning call's token usage when the
            // provider reports it (additive — absent changes nothing).
            ...(planned.usage ? { usage: planned.usage } : {}),
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/plan/stream") {
          // Streaming planning (v0.5.0, issue #110): provider thinking/text
          // deltas relay as NDJSON while the plan generates, then ONE
          // terminal `plan` event carries the authoritative reviewed plan —
          // the same planAndReview contract as POST /api/plan, streamed.
          // Refusals happen BEFORE the stream starts (plain JSON, never a
          // half-open stream): 400 missing intent, 503 provider unavailable.
          const body = await readJsonBody(req);
          const intent = typeof body["intent"] === "string" ? body["intent"].trim() : "";
          if (!intent) {
            sendJson(res, 400, { error: "intent (string) is required" });
            return;
          }
          const attachments = readAttachments(body);
          if (attachments.error !== undefined) {
            sendJson(res, 400, { error: attachments.error });
            return;
          }
          const provider = typeof body["provider"] === "string" ? body["provider"] : undefined;
          ensureCatalog();
          // Lazy stream start: headers go out with the first event. Errors
          // raised before any delta (unavailable provider, catalog failure)
          // therefore still answer as plain JSON, mirroring /api/plan.
          let streaming = false;
          const startStream = (): void => {
            if (streaming) return;
            streaming = true;
            res.writeHead(200, {
              "content-type": "application/x-ndjson; charset=utf-8",
              "cache-control": "no-store",
            });
          };
          const write = (event: unknown): void => {
            if (!res.writableEnded) res.write(JSON.stringify(event) + "\n");
          };
          try {
            const planned = await planAndReviewStream(
              intent,
              {
                provider,
                priorTurns: readPriorTurns(body),
                attachments: attachments.attachments,
              },
              (event) => {
                startStream();
                if (event.type === "usage") write({ type: "usage", usage: event.usage });
                else write(event); // reasoning_delta / text_delta verbatim
              },
            );
            if (planned.usage) notes.set(res, formatUsage(planned.usage));
            startStream();
            write({
              type: "plan",
              intent,
              plan: planned.plan,
              review: planned.review,
              provider: planned.providerName,
              providerLabel: planned.providerLabel,
              warnings: planned.warnings,
              ...(planned.usage ? { usage: planned.usage } : {}),
            });
          } catch (error) {
            if (!streaming) {
              // Stream never started — plain JSON error contract.
              if (error instanceof ProviderUnavailableError) {
                sendJson(res, 503, { error: error.message });
              } else {
                sendJson(res, 500, {
                  error: error instanceof Error ? error.message : String(error),
                });
              }
              return;
            }
            write({
              type: "error",
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            if (streaming) res.end();
          }
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
        if (req.method === "POST" && url.pathname === "/api/goal/stream") {
          // Agent mode (issue #97): runGoal over the SAME engine. Every round
          // is re-reviewed; non-"allow" rounds pause the stream until
          // /api/goal/approve decides (or the TTL ends the goal cancelled).
          const body = await readJsonBody(req);
          const intent = typeof body["intent"] === "string" ? body["intent"].trim() : "";
          if (!intent) {
            sendJson(res, 400, { error: "intent (string) is required" });
            return;
          }
          const rawRounds = body["maxRounds"];
          const maxRounds =
            typeof rawRounds === "number" && Number.isFinite(rawRounds) && rawRounds >= 1
              ? rawRounds
              : undefined;
          const provider = typeof body["provider"] === "string" ? body["provider"] : undefined;
          const attachments = readAttachments(body);
          if (attachments.error !== undefined) {
            sendJson(res, 400, { error: attachments.error });
            return;
          }
          ensureCatalog();
          const goalId = goalRegistry.createGoalId();
          const controller = new AbortController();
          // Client disconnect (Stop button, tab close) cancels the goal —
          // mid-shell included, via the engine's process-group kill.
          res.on("close", () => controller.abort());
          res.writeHead(200, {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
          });
          const write = (event: unknown): void => {
            if (!res.writableEnded) res.write(JSON.stringify(event) + "\n");
          };
          write({ type: "goal_registered", goalId });
          try {
            const result = await runGoal(intent, {
              provider,
              maxRounds,
              priorTurns: readPriorTurns(body),
              attachments: attachments.attachments,
              assumeYes: true,
              allowMediumAutoApprove: true,
              timeoutSec: WEBUI_TIMEOUT_SEC,
              autoApproveAll: true,
              signal: controller.signal,
              // runGoal's lifecycle + the per-round step_* events mirror
              // verbatim — additive event types only, shapes never bent.
              onGoalEvent: (event) => {
                // Annotate the log line with the latest round's AI cost.
                if (event.type === "round_end" && event.usage) {
                  notes.set(res, formatUsage(event.usage));
                }
                write(event);
              },
              onPlanEvent: (event) => write(event),
              // Provider thinking relay (v0.5.0, issue #110): per-round
              // reasoning/text deltas as round-tagged events so the client
              // can show WHAT the AI was thinking while each round planned.
              // usage stays on round_end (already relayed) — not duplicated.
              onPlanStream: (event, round) => {
                if (event.type === "usage") return;
                write({
                  type:
                    event.type === "reasoning_delta" ? "round_thinking_delta" : "round_text_delta",
                  round,
                  text: event.text,
                });
              },
              awaitApproval: (round) =>
                goalRegistry.awaitApproval(goalId, round, () => {
                  write({ type: "approval_timeout", round });
                }),
            });
            write({
              type: "goal_result",
              status: result.status,
              rounds: result.rounds.length,
              ...(result.answer !== undefined ? { answer: result.answer } : {}),
              ...(result.error !== undefined ? { error: result.error } : {}),
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
        if (req.method === "POST" && url.pathname === "/api/goal/approve") {
          const body = await readJsonBody(req);
          const goalId = typeof body["goalId"] === "string" ? body["goalId"] : "";
          if (!goalId) {
            sendJson(res, 400, { error: "goalId (string) is required" });
            return;
          }
          const decided = goalRegistry.approve(goalId, body["approve"] === true);
          if (!decided) {
            sendJson(res, 404, { error: `unknown or expired goal: ${goalId}` });
            return;
          }
          sendJson(res, 200, { ok: true });
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
  /** Request log sink — see {@link RequestListenerOptions.log}. */
  log?: (line: string) => void;
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
  const server = http.createServer(
    createRequestListener(options.log === undefined ? {} : { log: options.log }),
  );
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
