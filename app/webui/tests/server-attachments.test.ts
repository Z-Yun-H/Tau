/**
 * Image-attachment validation on the WebUI server (issue #135): the
 * whitelist (kind/mediaType), size caps, strict base64 and the magic-number
 * gate (a text file wearing a .png name can never pass), plus payload
 * threading into the planning context. Every refusal is a plain-JSON 400
 * BEFORE any stream starts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tauHome, type Plan, type PlanningContext } from "@tau/core";
import { registerProvider, resetProviders, registerProviderBuiltins } from "@tau/ai";
import { ensureCatalog } from "@tau/agent";
import { startWebUi } from "../src/server.js";
import type { RunningWebUi } from "../src/server.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";
let ui: RunningWebUi;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-attach-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  registerProviderBuiltins();
  ensureCatalog();
  ui = await startWebUi({ port: 0 });
});

afterEach(async () => {
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  delete process.env["TAU_WEBUI_QUIET"];
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
  resetProviders();
  registerProviderBuiltins();
});

/** Minimal valid PNG header, base64 (magic + IHDR dims — probeable). */
const PNG_B64 = Buffer.from(
  Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2,
    0, 0, 0, 3,
  ]),
).toString("base64");

const png = (name = "shot.png"): Record<string, unknown> => ({
  kind: "image",
  name,
  mediaType: "image/png",
  dataBase64: PNG_B64,
});

const post = async (pathname: string, payload: unknown): Promise<Response> =>
  fetch(new URL(pathname, ui.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

describe("attachment validation (POST /api/plan/stream)", () => {
  it("threads validated attachments into the planning context with vision wording", async () => {
    let captured: PlanningContext | undefined;
    registerProvider({
      name: "vision-capture",
      label: "vision capture",
      supportsVision: true,
      isAvailable: async () => true,
      plan: async (ctx) => {
        captured = ctx;
        return { explanation: "ok", steps: [] } satisfies Plan;
      },
    });
    const res = await post("/api/plan/stream", {
      intent: "what is in this picture",
      provider: "vision-capture",
      attachments: [png()],
    });
    expect(res.status).toBe(200);
    expect(captured?.attachments).toEqual([
      { kind: "image", name: "shot.png", mediaType: "image/png", dataBase64: PNG_B64 },
    ]);
    expect(captured?.intent).toContain("attached to this message");
  });

  it("rejects a non-array attachments field", async () => {
    const res = await post("/api/plan/stream", {
      intent: "x",
      attachments: "not-an-array",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("attachments (array)");
  });

  it("rejects non-image kinds and non-whitelisted media types", async () => {
    const badKind = await post("/api/plan/stream", {
      intent: "x",
      attachments: [{ ...png(), kind: "pdf" }],
    });
    expect(badKind.status).toBe(400);
    expect(((await badKind.json()) as { error: string }).error).toContain('only "image"');

    const badType = await post("/api/plan/stream", {
      intent: "x",
      attachments: [{ ...png(), mediaType: "image/svg+xml" }],
    });
    expect(badType.status).toBe(400);
    expect(((await badType.json()) as { error: string }).error).toContain("unsupported mediaType");
  });

  it("rejects invalid base64 and magic-number mismatches (renamed text file)", async () => {
    const badB64 = await post("/api/plan/stream", {
      intent: "x",
      attachments: [{ ...png(), dataBase64: "not!!base64" }],
    });
    expect(badB64.status).toBe(400);
    expect(((await badB64.json()) as { error: string }).error).toContain("base64");

    const textAsPng = await post("/api/plan/stream", {
      intent: "x",
      attachments: [
        { ...png(), dataBase64: Buffer.from("definitely not an image at all").toString("base64") },
      ],
    });
    expect(textAsPng.status).toBe(400);
    expect(((await textAsPng.json()) as { error: string }).error).toContain(
      "does not look like png",
    );
  });

  it("enforces the per-request count cap", async () => {
    const res = await post("/api/plan/stream", {
      intent: "x",
      attachments: [png("1.png"), png("2.png"), png("3.png"), png("4.png"), png("5.png")],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("too many attachments");
  });

  it("enforces the per-image size cap before decoding", async () => {
    const res = await post("/api/plan/stream", {
      intent: "x",
      attachments: [{ ...png(), dataBase64: "A".repeat(5_600_004) }],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("too large");
  });

  it("accepts a request without attachments untouched (historical body)", async () => {
    let captured: PlanningContext | undefined;
    registerProvider({
      name: "capture-plain",
      label: "capture",
      isAvailable: async () => true,
      plan: async (ctx) => {
        captured = ctx;
        return { explanation: "ok", steps: [] } satisfies Plan;
      },
    });
    const res = await post("/api/plan/stream", { intent: "plain", provider: "capture-plain" });
    expect(res.status).toBe(200);
    expect(captured?.attachments).toBeUndefined();
    expect(captured?.intent).toBe("plain");
  });
});

describe("attachment validation on the other planning endpoints", () => {
  it("POST /api/plan answers 400 for a bad attachment", async () => {
    const res = await post("/api/plan", {
      intent: "x",
      attachments: [{ ...png(), mediaType: "image/bmp" }],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("unsupported mediaType");
  });

  it("POST /api/goal/stream answers 400 as plain JSON BEFORE the stream starts", async () => {
    const res = await post("/api/goal/stream", {
      intent: "x",
      attachments: [{ kind: "image", mediaType: "image/png", dataBase64: "!!!!" }],
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(((await res.json()) as { error: string }).error).toContain("base64");
  });

  it("POST /api/goal/stream threads attachments into the goal's round-1 context", async () => {
    let captured: PlanningContext | undefined;
    registerProvider({
      name: "goal-vision-capture",
      label: "goal vision capture",
      supportsVision: true,
      isAvailable: async () => true,
      plan: async (ctx) => {
        captured = ctx;
        // shell step that ends the goal without needing approval
        return {
          explanation: "ok",
          steps: [{ kind: "shell", command: "echo GOAL_COMPLETE: done", reason: "r" }],
        } satisfies Plan;
      },
    });
    const res = await post("/api/goal/stream", {
      intent: "read the diagram",
      provider: "goal-vision-capture",
      attachments: [png("diagram.png")],
    });
    expect(res.status).toBe(200);
    expect(captured?.attachments).toHaveLength(1);
    expect(captured?.intent).toContain("attached to this message");
    const text = await res.text();
    const lines = text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const result = lines.at(-1) as Record<string, unknown>;
    expect(result["type"]).toBe("goal_result");
  });
});
