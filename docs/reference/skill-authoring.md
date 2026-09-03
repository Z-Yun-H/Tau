# 编写技能

本页面向给 **Tau 仓库本身**写技能的贡献者。给日常使用写技能请看 [tau skill new](/guide/skills) 的用户流程。

## SKILL.md 的三层模型

Tau 仓库里的 SKILL.md 分三层，放错位置是治理错误：

| 层  | 位置                                            | 性质                                                                    |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| L1  | `.claude/skills/*/SKILL.md`                     | 根开发流程技能（build/test/release/docs），跨切面                       |
| L2  | `packages/<pkg>/SKILL.md`、`app/<app>/SKILL.md` | 单包技能，挨着它治理的代码，随包版本化                                  |
| L3  | `packages/skills/bundled/<name>/`               | 随 CLI 发布的**产品内容**（运行时数据），用户通过 `tau skill list` 看到 |

根部的 `SKILL.md` 是**路由器**：按子系统把人路由到唯一指定的技能文件与规范文档。新增技能时同步更新路由表——每个开发工具有且只有一个指定入口。

## 编写规则

- **frontmatter 必填**：`name`、`description`（一句话说清何时触发）、`risk`。
- **内容结构**：先一句话定位（这是什么、不是什么），再操作路径，最后常见陷阱。宁可短而准，不要长而全。
- **声明式命令**：L3 技能的命令是声明（展开成意图），不是脚本；风险声明走与内置工具相同的门。
- **spec 引用**：技能是索引与工作流，规范性细节放 `AGENTS/<topic>.md` 并链接过去——同一规则只在一处定义。

## 用户技能 vs 仓库技能

- 给**用户**的能力 → L3 `packages/skills/bundled/`，或 `$TAU_HOME/skills/` / 工作区 `./skills/`（不进仓库）。
- 给**开发 AI agent** 的工作流 → L1 或 L2，进仓库，随代码一起评审。

## 检查清单

新技能 PR 必须包含：frontmatter 完整、根路由表（若新增根技能）、治理表行（`AGENTS/architecture.md`，若新增位置）、以及 `tau skill list` 的输出验证。
