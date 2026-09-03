/**
 * languageForFile parity — the WebUI file viewer (browser bundle) uses a
 * node-free MIRROR of `languageForFile` from @tau/tools (issue #109),
 * because the tools module pulls node:fs and cannot ship to the browser.
 * This test imports BOTH and fails on drift: one vocabulary, two runtimes,
 * one test. Extend the sample set whenever either side gains a language.
 */

import { describe, it, expect } from "vitest";
import { languageForFile as languageForFileTools } from "@tau/tools";
import { languageForFile } from "../client/lib/language.js";

const SAMPLES = [
  "app.ts",
  "Component.tsx",
  "script.mjs",
  "bundle.cjs",
  "pkg.json",
  "tsconfig.jsonc",
  "main.py",
  "app.rb",
  "index.php",
  "lib.rs",
  "main.go",
  "App.java",
  "Program.cs",
  "mem.c",
  "header.h",
  "impl.cpp",
  "impl.cc",
  "types.hpp",
  "config.yaml",
  "config.yml",
  "Cargo.toml",
  "settings.ini",
  "doc.xml",
  "index.html",
  "page.htm",
  "style.css",
  "theme.scss",
  "base.less",
  "README.md",
  "NOTES.markdown",
  "run.sh",
  "deploy.bash",
  "dot.zsh",
  "App.vue",
  "Widget.svelte",
  "query.sql",
  "App.kt",
  "Agent.swift",
  "Dockerfile",
  "dockerfile",
  "Containerfile",
  "Makefile",
  "Gemfile",
  "Rakefile",
  "file.test.ts",
  "archive.tar.gz",
  "LICENSE",
  ".gitignore",
  "data.weird",
  "nested/dir/app.vue",
  "C:\\repo\\pkg\\index.js",
];

describe("languageForFile parity (webui mirror vs @tau/tools)", () => {
  it("agrees on every sampled file name", () => {
    for (const name of SAMPLES) {
      expect(languageForFile(name), `mismatch for ${name}`).toBe(languageForFileTools(name));
    }
  });

  it("maps the languages the file viewer highlights", () => {
    expect(languageForFile("app.ts")).toBe("typescript");
    expect(languageForFile("main.py")).toBe("python");
    expect(languageForFile("config.yml")).toBe("yaml");
    expect(languageForFile("Cargo.toml")).toBe("toml");
    expect(languageForFile("README.md")).toBe("markdown");
    expect(languageForFile("index.html")).toBe("html");
    expect(languageForFile("style.css")).toBe("css");
    expect(languageForFile("run.sh")).toBe("bash");
    expect(languageForFile("main.go")).toBe("go");
    expect(languageForFile("lib.rs")).toBe("rust");
    expect(languageForFile("App.java")).toBe("java");
    expect(languageForFile("query.sql")).toBe("sql");
    expect(languageForFile("Dockerfile")).toBe("dockerfile");
  });

  it("falls back to text honestly", () => {
    expect(languageForFile("data.weird")).toBe("text");
    expect(languageForFile(".gitignore")).toBe("text");
    expect(languageForFile("LICENSE")).toBe("text");
    expect(languageForFile("archive.tar.gz")).toBe("text");
  });
});
