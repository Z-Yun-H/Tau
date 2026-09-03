import { defineConfig } from "vitepress";

/**
 * Tau documentation site — content is DECOMPOSED FROM THE PROJECT'S OWN
 * FEATURE MAP (issue #111): one guide page per user-facing surface
 * (ask / goal / tools / providers / skills / plugins / WebUI / TUI /
 * config), one reference page per architecture concern (architecture /
 * safety / provider-dev / skill-authoring). zh is the default locale;
 * en mirrors under /en/.
 *
 * Governance: docs/ is a PRIVATE workspace member — the docs are
 * content, never runtime data; the CLI does not read from here.
 * Authoring workflow: .claude/skills/tau-docs/SKILL.md.
 */

const zh = {
  label: "简体中文",
  lang: "zh-CN",
  themeConfig: {
    siteTitle: "Tau",
    nav: [
      { text: "指南", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "参考", link: "/reference/architecture", activeMatch: "/reference/" },
      { text: "English", link: "/en/guide/getting-started" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "开始",
          items: [
            { text: "安装与快速上手", link: "/guide/getting-started" },
            { text: "单轮问答（tau ask）", link: "/guide/ask" },
            { text: "多轮代理（tau goal）", link: "/guide/goal" },
          ],
        },
        {
          text: "能力",
          items: [
            { text: "内置工具", link: "/guide/tools" },
            { text: "AI Provider", link: "/guide/providers" },
            { text: "技能（Skills）", link: "/guide/skills" },
            { text: "插件（MCP）", link: "/guide/plugins" },
          ],
        },
        {
          text: "界面与配置",
          items: [
            { text: "Web 界面", link: "/guide/webui" },
            { text: "终端界面（TUI）", link: "/guide/tui" },
            { text: "配置参考", link: "/guide/config" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "架构与规范",
          items: [
            { text: "架构总览", link: "/reference/architecture" },
            { text: "安全模型", link: "/reference/safety" },
            { text: "接入新 Provider", link: "/reference/provider-dev" },
            { text: "编写技能", link: "/reference/skill-authoring" },
          ],
        },
      ],
    },
    outline: { label: "本页目录" },
    docFooter: { prev: "上一页", next: "下一页" },
    lastUpdated: { text: "最后更新" },
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
    lightModeSwitchTitle: "切换到浅色模式",
    darkModeSwitchTitle: "切换到深色模式",
  },
};

const en = {
  label: "English",
  lang: "en-US",
  link: "/en/guide/getting-started",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/en/guide/getting-started", activeMatch: "/en/guide/" },
      { text: "Reference", link: "/en/reference/architecture", activeMatch: "/en/reference/" },
      { text: "简体中文", link: "/guide/getting-started" },
    ],
    sidebar: {
      "/en/guide/": [
        {
          text: "Start",
          items: [
            { text: "Installation & quick start", link: "/en/guide/getting-started" },
            { text: "Single-round Q&A (tau ask)", link: "/en/guide/ask" },
            { text: "Multi-round agent (tau goal)", link: "/en/guide/goal" },
          ],
        },
        {
          text: "Capabilities",
          items: [
            { text: "Built-in tools", link: "/en/guide/tools" },
            { text: "AI providers", link: "/en/guide/providers" },
            { text: "Skills", link: "/en/guide/skills" },
            { text: "Plugins (MCP)", link: "/en/guide/plugins" },
          ],
        },
        {
          text: "Interfaces & config",
          items: [
            { text: "Web UI", link: "/en/guide/webui" },
            { text: "Terminal UI", link: "/en/guide/tui" },
            { text: "Configuration", link: "/en/guide/config" },
          ],
        },
      ],
      "/en/reference/": [
        {
          text: "Architecture & specs",
          items: [
            { text: "Architecture overview", link: "/en/reference/architecture" },
            { text: "Safety model", link: "/en/reference/safety" },
            { text: "Adding a provider", link: "/en/reference/provider-dev" },
            { text: "Authoring skills", link: "/en/reference/skill-authoring" },
          ],
        },
      ],
    },
    outline: { label: "On this page" },
  },
};

/**
 * Site base — GitHub Pages serves this repo as a PROJECT site at
 * https://z-yun-h.github.io/Tau/, so the default base is "/Tau/". Set
 * DOCS_BASE (e.g. "/" for a custom domain or local preview at root) to
 * override; the deploy workflow pins "/Tau/" explicitly.
 */
const base = process.env["DOCS_BASE"] ?? "/Tau/";

export default defineConfig({
  base,
  title: "Tau",
  description: "AI terminal assistant — natural language in, reviewed deterministic tools out",
  head: [["link", { rel: "icon", type: "image/svg+xml", href: `${base}logo.svg` }]],
  locales: {
    root: zh,
    en,
  },
  themeConfig: {
    socialLinks: [{ icon: "github", link: "https://github.com/Z-Yun-H/Tau" }],
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
              modal: {
                noResultsText: "未找到相关结果",
                resetButtonTitle: "清除查询条件",
                displayDetails: "显示详细列表",
                hideDetails: "隐藏详细列表",
                footer: { selectText: "选择", navigateText: "切换", closeText: "关闭" },
              },
            },
          },
        },
      },
    },
  },
  lastUpdated: true,
});
