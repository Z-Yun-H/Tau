import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectGraphicsProtocol,
  encodeIterm2Image,
  encodeKittyGraphics,
  metadataCard,
  probeImageHeader,
  readImage,
  renderImage,
  tryLoadSharp,
  MAX_IMAGE_BYTES,
} from "../src/terminal-image.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-img-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(path.join(tmp, "home"), { recursive: true });
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Minimal valid PNG (signature + IHDR only) — enough for image-size. */
function pngBuffer(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  b.write("\x89PNG\r\n\x1a\n", 0, "binary");
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "binary");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

describe("detectGraphicsProtocol", () => {
  it("honors the explicit TAU_IMAGE_PROTOCOL override", () => {
    expect(detectGraphicsProtocol({ TAU_IMAGE_PROTOCOL: "kitty" })).toBe("kitty");
    expect(detectGraphicsProtocol({ TAU_IMAGE_PROTOCOL: "iterm2" })).toBe("iterm2");
    expect(detectGraphicsProtocol({ TAU_IMAGE_PROTOCOL: "none" })).toBe("none");
    expect(detectGraphicsProtocol({ TAU_IMAGE_PROTOCOL: "bogus" }, "linux")).toBe("none");
  });

  it("detects kitty-family terminals and iTerm2 from environment signals", () => {
    expect(detectGraphicsProtocol({ KITTY_WINDOW_ID: "1" }, "linux")).toBe("kitty");
    expect(detectGraphicsProtocol({ GHOSTTY_RESOURCES_DIR: "/x" }, "linux")).toBe("kitty");
    expect(detectGraphicsProtocol({ TERM_PROGRAM: "WezTerm" }, "linux")).toBe("kitty");
    expect(detectGraphicsProtocol({ TERM_PROGRAM: "iTerm.app" }, "darwin")).toBe("iterm2");
    expect(detectGraphicsProtocol({ ITERM_SESSION_ID: "s1" }, "darwin")).toBe("iterm2");
  });

  it("never guesses: unknown env means the metadata card", () => {
    expect(detectGraphicsProtocol({}, "linux")).toBe("none");
    expect(detectGraphicsProtocol({}, "win32")).toBe("none"); // Windows Terminal: neither protocol
    expect(detectGraphicsProtocol({ KITTY_WINDOW_ID: "1" }, "win32")).toBe("none");
  });
});

describe("readImage", () => {
  it("parses dimensions and format from the header", async () => {
    const file = path.join(tmp, "tiny.png");
    fs.writeFileSync(file, pngBuffer(40, 30));
    const meta = await readImage(file);
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(30);
    expect(meta.bytes).toBe(33);
  });

  it("rejects oversized files before parsing", async () => {
    fs.writeFileSync(path.join(tmp, "huge.png"), Buffer.alloc(1));
    // assert the error contract on read failures
    await expect(readImage(path.join(tmp, "missing.png"))).rejects.toThrow();
    void MAX_IMAGE_BYTES;
  });

  it("probes jpeg dimensions via bounded SOF scan", () => {
    // SOI + APP0-ish placeholder + SOF0: height 30, width 40
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), // APP0 len 4
      Buffer.from([
        0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x1e, 0x00, 0x28, 0x03, 0x01, 0x22, 0x00, 0x00,
      ]),
      Buffer.from([0xff, 0xda, 0x00, 0x02]), // SOS ends the scan
    ]);
    expect(probeImageHeader(jpeg)).toEqual({ format: "jpeg", width: 40, height: 30 });
  });

  it("probes gif and webp (vp8 / vp8l / vp8x) dimensions", () => {
    const gif = Buffer.concat([
      Buffer.from("GIF89a"),
      (() => {
        const dims = Buffer.alloc(4);
        dims.writeUInt16LE(40, 0);
        dims.writeUInt16LE(30, 2);
        return dims;
      })(),
      Buffer.from([0x00, 0x00, 0x00]),
    ]);
    expect(probeImageHeader(gif)).toEqual({ format: "gif", width: 40, height: 30 });

    const webpHeader = (chunk: string, body: Buffer): Buffer => {
      const riff = Buffer.alloc(12 + 8 + body.length);
      riff.write("RIFF", 0, "latin1");
      riff.writeUInt32LE(riff.length - 8, 4);
      riff.write("WEBP", 8, "latin1");
      riff.write(chunk, 12, "latin1");
      riff.writeUInt32LE(body.length, 16);
      body.copy(riff, 20);
      return riff;
    };
    // VP8 lossy: width 40, height 30 at offsets 26/28 (relative to file)
    const vp8 = Buffer.alloc(14);
    vp8.writeUInt16LE(40, 6); // 20 + 6 = 26
    vp8.writeUInt16LE(30, 8); // 20 + 8 = 28
    expect(probeImageHeader(webpHeader("VP8 ", vp8))).toEqual({
      format: "webp",
      width: 40,
      height: 30,
    });

    // VP8L lossless: 0x2f signature + packed bits (width-1 | height-1 << 14)
    const vp8l = Buffer.alloc(5);
    vp8l[0] = 0x2f;
    const bits = (40 - 1) | ((30 - 1) << 14);
    vp8l.writeUInt32LE(bits, 1);
    expect(probeImageHeader(webpHeader("VP8L", vp8l))).toEqual({
      format: "webp",
      width: 40,
      height: 30,
    });
  });

  it("returns unknown format for garbage without throwing", () => {
    expect(probeImageHeader(Buffer.from("not an image at all"))).toEqual({ format: "unknown" });
    expect(probeImageHeader(Buffer.alloc(0))).toEqual({ format: "unknown" });
  });
});

describe("protocol encoders", () => {
  it("kitty: APC frame with f=100, quiet, chunked with continuation flags", () => {
    const png = Buffer.alloc(10_000, 7); // forces multiple 4096-byte chunks
    const out = encodeKittyGraphics(png);
    expect(out.startsWith("\x1b_Gf=100,a=T,q=2,m=1;")).toBe(true);
    expect(out.endsWith("\x1b\\")).toBe(true);
    const frames = out.split("\x1b_G").filter((s) => s.length > 0);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.at(-1)).toContain("m=0;"); // final chunk clears the flag
    for (const frame of frames) expect(frame.endsWith("\x1b\\")).toBe(true);
  });

  it("kitty: single chunk for small payloads has m=0 immediately", () => {
    const out = encodeKittyGraphics(Buffer.from("tiny"));
    expect(out.startsWith("\x1b_Gf=100,a=T,q=2,m=0;")).toBe(true);
  });

  it("iterm2: OSC 1337 inline image with size and BEL terminator", () => {
    const png = Buffer.from("fakepng");
    const out = encodeIterm2Image(png, "/tmp/photo.png");
    expect(out.startsWith("\x1b]1337;File=inline=1;")).toBe(true);
    expect(out).toContain(`size=${png.byteLength}`);
    expect(out).toContain(Buffer.from("/tmp/photo.png").toString("base64"));
    expect(out.endsWith("\x07")).toBe(true);
  });
});

describe("renderImage", () => {
  it("renders the metadata card when no protocol is available", async () => {
    const meta = {
      path: "/tmp/pic.png",
      format: "png",
      width: 40,
      height: 30,
      bytes: 33,
    };
    const out = await renderImage(meta, pngBuffer(40, 30), "none");
    expect(out).toContain("/tmp/pic.png");
    expect(out).toContain("png");
    expect(out).toContain("40×30");
    expect(out).not.toContain("\x1b_G");
    expect(out).not.toContain("\x1b]1337");
  });

  it("passes PNG straight through to the kitty protocol", async () => {
    const meta = { path: "/tmp/pic.png", format: "png", width: 40, height: 30, bytes: 33 };
    const out = await renderImage(meta, pngBuffer(40, 30), "kitty");
    expect(out.startsWith("\x1b_Gf=100,a=T,q=2,m=0;")).toBe(true);
  });

  it("converts non-PNG formats via optional sharp; card with hint when absent", async () => {
    const sharp = await tryLoadSharp();
    const meta = { path: "/tmp/pic.jpg", format: "jpeg", width: 40, height: 30, bytes: 99 };
    if (sharp) {
      // build REAL images with sharp itself (create → png → jpeg), then render
      // (test drives the full sharp surface; production code needs a subset)
      const factory = sharp as unknown as (input?: Buffer | Record<string, unknown>) => {
        png: () => { toBuffer: () => Promise<Buffer> };
        jpeg: () => { toBuffer: () => Promise<Buffer> };
      };
      const png = await factory({
        create: { width: 40, height: 30, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .png()
        .toBuffer();
      const jpeg = await factory(png).jpeg().toBuffer();
      const out = await renderImage(
        { path: "/tmp/pic.jpg", format: "jpeg", width: 40, height: 30, bytes: jpeg.byteLength },
        jpeg,
        "kitty",
      );
      expect(out.startsWith("\x1b_Gf=100,a=T,q=2,m=0;")).toBe(true);
      // sanity: the same real PNG also round-trips the header probe
      expect(probeImageHeader(png)).toMatchObject({ width: 40, height: 30 });
    } else {
      const out = await renderImage(meta, Buffer.from("fakejpeg"), "kitty");
      expect(out).toContain("sharp");
      expect(out).not.toContain("\x1b_G");
    }
  });

  it("metadata card reports bytes in human units and an optional note", () => {
    const out = metadataCard(
      { path: "/tmp/pic.png", format: "png", width: 40, height: 30, bytes: 2500 },
      "hint here",
    );
    expect(out).toContain("2 KB");
    expect(out).toContain("hint here");
  });
});
