import { describe, it, expect, beforeAll } from "vitest";
import net from "node:net";
import { registerCoreTools, getTool } from "../src/index.js";

beforeAll(() => registerCoreTools());

describe("sys.info", () => {
  it("reports platform and memory", async () => {
    const result = await getTool("sys.info")!.run({});
    expect(result.text).toContain(`platform: ${process.platform}`);
    expect(result.text).toContain("memory:");
    expect(result.text).toContain("node: v");
  });
});

describe("sys.disk", () => {
  it("reports total/used/free", async () => {
    const result = await getTool("sys.disk")!.run({ path: "." });
    expect(result.text).toContain("total:");
    expect(result.text).toContain("free:");
  });
});

describe("sys.proc", () => {
  it("returns rows on unix, graceful message on windows", async () => {
    const result = await getTool("sys.proc")!.run({ limit: 3 });
    if (process.platform === "win32") {
      expect(result.text).toMatch(/not supported on Windows/i);
    } else {
      expect(result.text).toContain("PID");
    }
  });
});

describe("net.port", () => {
  it("detects an open port", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as net.AddressInfo;
    try {
      const result = await getTool("net.port")!.run({ host: "127.0.0.1", port: address.port });
      expect(result.text).toContain("OPEN");
    } finally {
      server.close();
    }
  });

  it("detects a closed port", async () => {
    const result = await getTool("net.port")!.run({ host: "127.0.0.1", port: 1, timeout: 1 });
    expect(result.text).toContain("CLOSED");
  });

  it("validates the port range", async () => {
    await expect(getTool("net.port")!.run({ port: 99999 })).rejects.toThrow(/between 1 and 65535/i);
  });
});

describe("net.fetch", () => {
  it("refuses private addresses by default (SSRF guard)", async () => {
    await expect(getTool("net.fetch")!.run({ url: "http://127.0.0.1:8080/x" })).rejects.toThrow(
      /private address/i,
    );
    await expect(getTool("net.fetch")!.run({ url: "http://192.168.1.1/admin" })).rejects.toThrow(
      /private address/i,
    );
  });

  it("requires an absolute http(s) URL", async () => {
    await expect(getTool("net.fetch")!.run({ url: "ftp://x" })).rejects.toThrow(/absolute http/i);
  });
});

describe("net.ping", () => {
  it("rejects shell metacharacters in host", async () => {
    await expect(getTool("net.ping")!.run({ host: "a;rm -rf /" })).rejects.toThrow(
      /no shell metacharacters/i,
    );
  });
});

describe("sys.datetime", () => {
  it("reports ISO, epoch and timezone", async () => {
    const result = await getTool("sys.datetime")!.run({});
    expect(result.text).toContain("iso: ");
    expect(result.text).toContain("epoch_ms: ");
    expect(result.text).toContain("timezone: ");
    const data = result.data as { iso: string; epochMs: number };
    expect(Number.isFinite(data.epochMs)).toBe(true);
    expect(Number.isNaN(Date.parse(data.iso))).toBe(false);
  });
});

describe("sys.which", () => {
  it("resolves a command injected into PATH and reports honest misses", async () => {
    const os = await import("node:os");
    const fsMod = await import("node:fs");
    const nodePath = await import("node:path");
    const dir = fsMod.mkdtempSync(nodePath.join(os.tmpdir(), "tau-which-"));
    fsMod.writeFileSync(nodePath.join(dir, "tau-which-target"), "#!/bin/sh\n");
    const saved = process.env["PATH"];
    process.env["PATH"] = `${dir}${nodePath.delimiter}${saved ?? ""}`;
    try {
      const hit = await getTool("sys.which")!.run({ command: "tau-which-target" });
      expect(hit.text).toContain(nodePath.join(dir, "tau-which-target"));
      const miss = await getTool("sys.which")!.run({ command: "tau-which-nope-xyz" });
      expect(miss.text).toContain("not found in PATH");
    } finally {
      process.env["PATH"] = saved;
      fsMod.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects path separators", async () => {
    await expect(getTool("sys.which")!.run({ command: "a/b" })).rejects.toThrow(
      /bare command name/i,
    );
  });
});

describe("sys.env", () => {
  it("reads one variable, reports unset honestly, rejects bad names", async () => {
    process.env["TAU_TEST_ENV_VAR"] = "hello-world";
    const hit = await getTool("sys.env")!.run({ name: "TAU_TEST_ENV_VAR" });
    expect(hit.text).toContain("TAU_TEST_ENV_VAR=hello-world");
    delete process.env["TAU_TEST_ENV_VAR"];
    const miss = await getTool("sys.env")!.run({ name: "TAU_TEST_ENV_VAR" });
    expect(miss.text).toContain("is not set");
    await expect(getTool("sys.env")!.run({ name: "not a name" })).rejects.toThrow(/NAME/i);
  });
});
