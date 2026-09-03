# 技能（Skills）

技能是 Tau 的轻量扩展机制：一个技能就是一个 `SKILL.md` 文件（外加可选的文档），向 AI 的提示里注入结构化描述与**声明式命令**——无需写任何 TypeScript 代码。

## 三种作用域

| 作用域    | 位置                                                | 来源         |
| --------- | --------------------------------------------------- | ------------ |
| bundled   | 包内 `packages/skills/bundled/`                     | 随 CLI 发布  |
| user      | `$TAU_HOME/skills/<name>/`（默认 `~/.tau/skills/`） | 你手动安装   |
| workspace | 项目里 `./skills/` 或 `./.tau/skills/`              | 跟随你的仓库 |

`tau skill list` 会列出全部作用域的技能；`tau skill new <name> "<描述>"` 用官方模板生成骨架。

## 一个技能长什么样

```
my-skill/
  SKILL.md      # frontmatter（name/description/risk）+ 命令定义 + 注入说明
```

技能里的命令是**声明式**的：定义"这个命令展开成什么意图/工具调用"，而不是可执行脚本。风险声明（low/medium/high）走与内置工具相同的审查门——medium+ 命令同样要过确认，技能不能绕过安全模型。

## 与插件（MCP）的边界

需要声明式命令、提示注入、零代码 → **技能**。需要真正的外部工具服务器（独立进程、自定义协议实现）→ [插件](/guide/plugins)。技能是文档级扩展，插件是进程级扩展。

## 为仓库写技能

想给 Tau 本身的开发流程写技能（或了解 SKILL.md 在本仓库里的三层模型），见[编写技能](/reference/skill-authoring)。
