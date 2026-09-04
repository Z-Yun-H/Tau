/**
 * Client attachment helpers (issue #135): base64 chunking, the
 * all-or-nothing batch conversion with readable errors, the extension
 * fallback for files with an empty browser type, and the payload/meta
 * projections (payload rides the request; meta keeps a runtime preview).
 */

import { describe, it, expect } from "vitest";
import {
  MAX_ATTACHMENTS,
  bytesToBase64,
  describeBytes,
  draftToMeta,
  draftToPayload,
  filesToDrafts,
  type FileLike,
} from "../client/lib/attachments.js";

function pngBytes(width = 2, height = 3): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(b.buffer);
  view.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

/** Duck-typed File stub — no DOM needed. */
function fileStub(init: {
  name?: string;
  type: string;
  size?: number;
  bytes?: Uint8Array;
}): FileLike {
  const bytes = init.bytes ?? pngBytes();
  return {
    ...(init.name ? { name: init.name } : {}),
    type: init.type,
    size: init.size ?? bytes.byteLength,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

describe("bytesToBase64", () => {
  it("matches the reference encoding for ASCII and binary data", () => {
    expect(bytesToBase64(new TextEncoder().encode("hello"))).toBe(
      Buffer.from("hello").toString("base64"),
    );
    const big = new Uint8Array(64 * 1024 + 7).map((_, i) => (i * 31) % 256);
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });
});

describe("describeBytes", () => {
  it("formats KB and MB", () => {
    expect(describeBytes(512)).toBe("1 KB");
    expect(describeBytes(380 * 1024)).toBe("380 KB");
    expect(describeBytes(1.2 * 1024 * 1024)).toBe("1.2 MB");
  });
});

describe("filesToDrafts", () => {
  it("converts a valid png into a sendable draft", async () => {
    const bytes = pngBytes();
    const { drafts, error } = await filesToDrafts([
      fileStub({ name: "shot.png", type: "image/png" }),
    ]);
    expect(error).toBeUndefined();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      name: "shot.png",
      mediaType: "image/png",
      bytes: 24,
      dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    });
    expect(drafts[0]!.dataBase64).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("falls back to the file extension when the browser sends an empty type", async () => {
    const { drafts, error } = await filesToDrafts([fileStub({ name: "pic.jpeg", type: "" })]);
    expect(error).toBeUndefined();
    expect(drafts[0]!.mediaType).toBe("image/jpeg");
  });

  it("rejects unsupported types with a readable batch error", async () => {
    const { drafts, error } = await filesToDrafts([
      fileStub({ name: "doc.pdf", type: "application/pdf" }),
    ]);
    expect(drafts).toEqual([]);
    expect(error).toContain("doc.pdf");
    expect(error).toContain("unsupported type");
  });

  it("rejects oversize and empty files", async () => {
    const oversize = await filesToDrafts([
      fileStub({ name: "big.png", type: "image/png", size: 5 * 1024 * 1024 }),
    ]);
    expect(oversize.error).toContain("big.png");
    expect(oversize.error).toContain("4.0 MB");

    const empty = await filesToDrafts([fileStub({ name: "e.png", type: "image/png", size: 0 })]);
    expect(empty.error).toContain("empty");
  });

  it("enforces the combined cap with the composer's existing drafts", async () => {
    const batch = Array.from({ length: 3 }, (_, i) =>
      fileStub({ name: `${i}.png`, type: "image/png" }),
    );
    const within = await filesToDrafts(batch, MAX_ATTACHMENTS - 3);
    expect(within.error).toBeUndefined();
    const over = await filesToDrafts(batch, MAX_ATTACHMENTS - 2);
    expect(over.error).toContain("up to 4 images");
  });

  it("all-or-nothing: one bad file aborts the whole batch", async () => {
    const { drafts, error } = await filesToDrafts([
      fileStub({ name: "good.png", type: "image/png" }),
      fileStub({ name: "bad.bmp", type: "image/bmp" }),
    ]);
    expect(drafts).toEqual([]);
    expect(error).toContain("bad.bmp");
  });
});

describe("draft projections", () => {
  it("payload carries raw base64 exactly as the server validates it", async () => {
    const { drafts } = await filesToDrafts([fileStub({ name: "shot.png", type: "image/png" })]);
    expect(draftToPayload(drafts[0]!)).toEqual({
      kind: "image",
      name: "shot.png",
      mediaType: "image/png",
      dataBase64: drafts[0]!.dataBase64,
    });
  });

  it("meta keeps the preview and drops the payload", async () => {
    const { drafts } = await filesToDrafts([fileStub({ name: "shot.png", type: "image/png" })]);
    const meta = draftToMeta(drafts[0]!);
    expect(meta).toEqual({
      name: "shot.png",
      mediaType: "image/png",
      bytes: 24,
      thumb: drafts[0]!.dataUrl,
    });
    expect(JSON.stringify(meta)).not.toContain("dataBase64");
  });
});
