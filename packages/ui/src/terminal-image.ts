/**
 * Terminal image rendering — a @tau/ui primitive (like theme/confirm/picker).
 *
 * Strategy ladder, honest at every rung:
 * 1. Protocol detection: Kitty graphics protocol (kitty, ghostty, WezTerm)
 *    or iTerm2 inline images (iTerm2); explicit `TAU_IMAGE_PROTOCOL`
 *    override; otherwise "none" — a styled metadata card is rendered instead
 *    of garbage escape codes (Windows Terminal ships neither protocol).
 * 2. Format support: PNG passes through as-is for both protocols. Any other
 *    format (JPEG/WebP/GIF/AVIF/...) is converted to PNG via the OPTIONAL
 *    `sharp` dependency — dynamically imported, never bundled, graceful
 *    degradation when absent (the sanctioned optionalDependencies pattern,
 *    golden rule 4). Without sharp: metadata card + an actionable hint.
 * 3. Oversized images are downscaled (max 800px wide) when sharp is
 *    available so they fit a typical terminal pane.
 * 4. Metadata comes from an in-house fixed-offset header parser (PNG/JPEG/
 *    GIF/WebP) — NOT the `image-size` package, whose every published version
 *    carries unpatched HIGH advisories (ICNS / JXL+HEIF infinite-loop DoS,
 *    GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) that the `pnpm audit --prod`
 *    gate correctly refuses.
 */

import fs from "node:fs/promises";
import { theme } from "./theme.js";

export type GraphicsProtocol = "kitty" | "iterm2" | "none";

export interface ImageMeta {
  /** Absolute or user-relative path as given. */
  path: string;
  /** Image format identifier from the header (e.g. "png", "jpeg"). */
  format: string;
  width?: number;
  height?: number;
  bytes: number;
}

/** Maximum image file size accepted for terminal rendering (20 MiB). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Pixel width budget for downscaled rendering (sharp present). */
const MAX_RENDER_WIDTH_PX = 800;

/**
 * Detect which inline-image protocol the terminal speaks — pure over the
 * injected env so it is testable. Never guesses "kitty" on a terminal that
 * merely might support it: no signal means "none" (metadata card).
 */
export function detectGraphicsProtocol(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): GraphicsProtocol {
  const override = env["TAU_IMAGE_PROTOCOL"];
  if (override === "kitty" || override === "iterm2" || override === "none") {
    return override;
  }
  if (platform === "win32") return "none"; // Windows Terminal: neither protocol
  if (env["KITTY_WINDOW_ID"] || env["GHOSTTY_RESOURCES_DIR"]) return "kitty";
  if (env["TERM_PROGRAM"] === "WezTerm") return "kitty"; // kitty graphics compatible
  if (env["TERM_PROGRAM"] === "iTerm.app" || env["ITERM_SESSION_ID"]) return "iterm2";
  return "none";
}

/** Minimal structural type for the pieces of sharp we use — decouples us
 * from sharp's `export =` type shape across versions. */
interface SharpPipeline {
  resize: (options: { width: number }) => SharpPipeline;
  png: () => { toBuffer: () => Promise<Buffer> };
}
type SharpFactory = (input: Buffer | string, options?: Record<string, unknown>) => SharpPipeline;

/** Load the optional sharp dependency; null when absent (never throws). */
let sharpPromise: Promise<SharpFactory | null> | null = null;
export function tryLoadSharp(): Promise<SharpFactory | null> {
  sharpPromise ??= import("sharp")
    .then((mod) => (mod as unknown as { default?: SharpFactory }).default ?? null)
    .catch(() => null);
  return sharpPromise;
}

/** Read an image file. Throws on read errors/oversize. */
export async function readImage(filePath: string): Promise<ImageMeta> {
  const buffer = await fs.readFile(filePath);
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`image larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MiB`);
  }
  const probe = probeImageHeader(buffer);
  return {
    path: filePath,
    format: probe.format,
    width: probe.width,
    height: probe.height,
    bytes: buffer.byteLength,
  };
}

/* ------------------------------------------------------------------ *
 * Header probing — an in-house, fixed-offset parser for the four
 * formats users actually preview (PNG/JPEG/GIF/WebP). The vulnerable
 * parsers' formats (ICNS/JXL/HEIF) are never touched; exotic formats
 * still render via the optional sharp pipeline. The JPEG marker scan
 * is hard-capped so hostile files cannot spin here.
 * ------------------------------------------------------------------ */

export interface ImageProbe {
  format: string;
  width?: number;
  height?: number;
}

const JPEG_SCAN_LIMIT = 64 * 1024;

export function probeImageHeader(b: Buffer): ImageProbe {
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { format: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 10 && b.subarray(0, 6).toString("latin1").startsWith("GIF8")) {
    return { format: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (
    b.length >= 24 &&
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return probeWebP(b);
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    return probeJPEG(b);
  }
  return { format: "unknown" };
}

function probeWebP(b: Buffer): ImageProbe {
  const chunk = b.subarray(12, 16).toString("latin1");
  if (chunk === "VP8 ") {
    // lossy: width/height LE u16 (14 bits) at fixed offsets 26/28
    if (b.length < 30) return { format: "webp" };
    return {
      format: "webp",
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    // lossless: signature byte 0x2f at 20, then packed 14-bit dimensions
    if (b.length < 25 || b[20] !== 0x2f) return { format: "webp" };
    const bits = b.readUInt32LE(21);
    return {
      format: "webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8X") {
    // extended: 24-bit LE width-1 at 24, height-1 at 27
    if (b.length < 30) return { format: "webp" };
    return {
      format: "webp",
      width: b.readUIntLE(24, 3) + 1,
      height: b.readUIntLE(27, 3) + 1,
    };
  }
  return { format: "webp" };
}

function probeJPEG(b: Buffer): ImageProbe {
  let offset = 2;
  while (offset + 9 < b.length && offset < JPEG_SCAN_LIMIT) {
    if (b[offset] !== 0xff) return { format: "jpeg" };
    const marker = b[offset + 1] ?? 0;
    // SOF0/1/2 (baseline/extended/progressive) carry the dimensions
    if (marker >= 0xc0 && marker <= 0xc2) {
      return {
        format: "jpeg",
        height: b.readUInt16BE(offset + 5),
        width: b.readUInt16BE(offset + 7),
      };
    }
    if (marker === 0xda) break; // start of scan — dimensions already missed
    const len = b.readUInt16BE(offset + 2);
    if (len < 2) break;
    offset += 2 + len;
  }
  return { format: "jpeg" };
}

/** Styled, informative fallback — never garbage escape codes. */
export function metadataCard(meta: ImageMeta, note?: string): string {
  const kb =
    meta.bytes >= 1024 * 1024
      ? `${(meta.bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(meta.bytes / 1024))} KB`;
  const dims = meta.width && meta.height ? `${meta.width}×${meta.height}` : "unknown size";
  const lines = [
    theme.brand("image") + `  ${meta.path}`,
    `  ${theme.muted("format:")} ${meta.format}   ${theme.muted("size:")} ${dims}   ${theme.muted("bytes:")} ${kb}`,
  ];
  if (note) lines.push(`  ${theme.warn(note)}`);
  return lines.join("\n");
}

const SHARP_HINT = "this format needs the optional 'sharp' package — PNG previews work without it";

/**
 * Render an image for the terminal: protocol-encoded inline image, or the
 * metadata card when the protocol/format combination is not available.
 * Returns the string the caller should print (already newline-terminated
 * content, no trailing blank line).
 */
export async function renderImage(
  meta: ImageMeta,
  buffer: Buffer,
  protocol: GraphicsProtocol = detectGraphicsProtocol(),
): Promise<string> {
  if (protocol === "none") {
    return metadataCard(meta, "terminal does not advertise an inline-image protocol");
  }

  let png: Buffer;
  if (meta.format === "png") {
    png = buffer;
  } else {
    const sharp = await tryLoadSharp();
    if (!sharp) return metadataCard(meta, SHARP_HINT);
    let pipeline = sharp(buffer);
    if ((meta.width ?? 0) > MAX_RENDER_WIDTH_PX) {
      pipeline = pipeline.resize({ width: MAX_RENDER_WIDTH_PX });
    }
    png = await pipeline.png().toBuffer();
  }

  return protocol === "kitty" ? encodeKittyGraphics(png) : encodeIterm2Image(png, meta.path);
}

/**
 * Kitty graphics protocol: APC `\x1b_G...;\x1b\\` with f=100 (PNG payload),
 * base64 chunked at 4096 bytes with `m=1` continuation flags, `q=2` silent,
 * `a=T` transmit-and-display.
 */
export function encodeKittyGraphics(png: Buffer): string {
  const payload = png.toString("base64");
  const chunkSize = 4096;
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += chunkSize) {
    chunks.push(payload.slice(i, i + chunkSize));
  }
  const parts: string[] = [];
  chunks.forEach((chunk, index) => {
    const first = index === 0;
    const last = index === chunks.length - 1;
    const header = first ? `f=100,a=T,q=2,m=${last ? 0 : 1}` : `m=${last ? 0 : 1}`;
    parts.push(`\x1b_G${header};${chunk}\x1b\\`);
  });
  return parts.join("");
}

/** iTerm2 inline image: OSC 1337 File=inline=1 with BEL terminator. */
export function encodeIterm2Image(png: Buffer, name: string): string {
  const nameB64 = Buffer.from(name, "utf8").toString("base64");
  return `\x1b]1337;File=inline=1;size=${png.byteLength};name=${nameB64}:${png.toString("base64")}\x07`;
}
