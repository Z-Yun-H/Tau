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
