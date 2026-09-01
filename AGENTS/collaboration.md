# AGENTS/collaboration.md — AI 助手代码协作操作规范（v2，更新版）

> **Language note / 语言说明**: this rulebook is normative in Chinese by
> maintainer decision (it transcribes the maintainer's collaboration
> contract verbatim). The English TL;DR below is a convenience summary —
> where the two disagree, the Chinese text wins.
> **本文件为 AI 协作的强制规范。** Every AI agent working in this repo MUST
> read and follow it; it overrides habits from other projects. Source of
> authority: the maintainer's collaboration directive — adopted 2026-08,
> **updated 2026-09（"总要求·更新版"）**, transcribed here as v2.

## English TL;DR (non-normative)

1. Understand the project systemically before touching code; keep docs in sync; if a required doc is missing, create it and justify it in the PR/report.
2. Tech selection is frozen: no new framework, library or tool without an approved Issue; state rationale and impact in the PR.
3. Flow by change type: features / refactors / architecture → Issue first, one PR = one Issue, PR body references it (`Closes #N`); simple, unambiguous fixes may be direct commits with clear messages — but Tau's `main` is protected, so even fixes land through a PR branch; never bypass PR for reviewable changes. Compound requests spanning multiple change types or subsystems must be auto-decomposed into independently reviewable one-Issue-one-PR units BEFORE implementation, with the decomposition published first (§3).
4. Dependency updates are standalone PRs with add/upgrade/remove lists, `pnpm audit` results, and full test results; never change workspace/dependency strategy without maintainer approval.
5. Docs must be synced in the same PR (both READMEs, AGENTS, docs/); state doc status in the PR body; respect root-vs-subpackage doc responsibilities.
6. Refactors / architecture changes: `[REFACTOR]` / `[ARCHITECTURE]` tag in PR title, motivation + impact + risk + structure-impact statement, and NEVER self-merge.
7. Every AI PR body prominently notes "此 PR 由 AI 生成"; every AI commit message carries the `AI-Generated: <说明>` prefix line AND the `AI-declaration:` trailer block (see AGENTS/release.md / .gitmessage).
8. **Daily changelog folder**: every working day appends `changelog/YYYY-MM-DD.md` (summary, type, Issue/PR refs, impact); `CHANGELOG.md` remains the release-level summary distilled from it. Every PR still carries a `CHANGELOG.md` Unreleased fragment.
9. Behavior-rule changes → update `AGENTS.md`/`AGENTS/`; executable-skill changes → update `.claude/skills/`; state the check result in the PR body.
10. No dead code, no needless hardcoding: clean up what you touch, extract hardcoded values into constants/env/config without behavior change; large cleanups go standalone.
11. Tests are mandatory: updated with the change, full suite green before submit, results reported in the PR body; CI failures are root-caused, never bypassed.
12. AI never merges any PR (including its own); human review is mandatory; high-risk/architecture PRs need an extra explicit core-member approval.
13. Respect configured automation; keep every action traceable; self-correct violations and notify the maintainer. Run the pre-task self-check list before starting any task.

---

## 0. 适用范围与强制力

- 本规范为 AI 助手参与本项目（及维护者任何项目）代码协作时的**强制最低要求**，适用于所有任务，不局限于特定技术栈或业务场景。
- AI 助手必须逐条执行，不得以任何理由绕过或省略。如有不确定之处，应**主动询问维护者**，而非自行决定。
- 本规范为"总要求·最低线"；Tau 自身的更严约束（如 `main` 分支保护、运行时依赖冻结）**叠加生效**，冲突时取更严者。

## 1. 项目理解与文档初始化

- **必须**在接手新项目或分析原有项目时，首先进行系统性理解，包括但不限于：
  - 代码结构、模块划分、依赖关系
  - 构建、测试、部署流程
  - 现有文档（README、CHANGELOG、AGENTS.md、SKILL.md / `.claude/skills/` 等）及覆盖程度
  - 项目约定（代码风格、分支策略、提交规范、技术选型等）
- **必须**基于理解结果，判断项目是否缺失 `CHANGELOG.md`、`AGENTS.md`、`SKILL.md` 或相关必要文档，并酌情补充：
  - 若项目已有这些文件，检查其内容是否与当前代码一致，若过时则提出更新。
  - 若项目缺失且有必要，创建相应文档，并在 PR 或报告中**说明创建理由**。
- **必须**在理解过程中发挥自主理解能力，总结项目架构、关键模块、核心流程和风险点，形成结构化认知，不得机械照搬现有描述；Tau 的入口是 `AGENTS.md` + `AGENTS/` 规则本。
- **禁止**在不理解项目背景和结构的情况下直接进行代码修改或提交。
- **必须**保证文档更新与代码变动同步，任何影响接口、行为、架构的改动都必须同步更新相关文档。

## 2. 技术选型与架构约束

- **必须**遵循项目已确定的技术选型、架构模式和工具链，不得擅自引入新的框架、库或工具（Tau 叠加约束：运行时依赖冻结，见 AGENTS.md 黄金规则 4）。
- 如需引入新技术或进行重大架构调整，**必须**先通过 Issue 提出方案，说明理由、影响范围和备选方案，获得维护者批准后方可实施。
- **必须**在 PR 描述中说明本次变更涉及的技术选型依据（如有变更）及对现有架构的影响。
- **禁止**在未经讨论的情况下进行破坏性架构调整或替换核心依赖。

## 3. 提交 Issue 与 PR 的流程（按变更类型区分）

- **功能新增、重构、架构调整**类变更：
  - **必须**在每次代码合并前，先创建或关联对应的 Issue。
  - **必须**确保一个 PR 只对应一个 Issue，禁止将多个不相关改动混入同一 PR。
  - **必须**在 PR 描述中引用 Issue 编号（如 `Closes #123`），并保持描述清晰完整（What & why / 如何测试 / 结构影响说明 / 文档更新情况）。
- **缺陷修复（fix）**类变更：
  - 对于简单明确的修复，可以直接通过 commit 提交，但必须保证 commit message 清晰描述问题与修复内容，并遵循项目的提交规范（Conventional Commits）。
  - 若修复涉及行为改变、接口调整或可能影响其他功能，仍**必须**先创建 Issue 并走 PR 流程。
- **禁止**将功能、重构等需要审核的变更以直接 commit 的方式绕过 PR 流程。
- Tau 叠加约束：`main` 为保护分支（AGENTS/release.md "Never push directly to `main`"），因此**一切变更（含简单 fix）最终都经由 PR 落地**；"直接 commit" 指在特性分支上免 Issue 直接提交，随后仍以 PR 汇入。

### 复合需求自动分解（compound-request decomposition）

- 当维护者一次性下达跨越多个变更类型（docs / refactor / feat / fix）或多个子系统的**复合需求**时，AI **必须**先进行需求分解，**禁止**将复合需求整体压入单一 Issue 或 PR 处理。
- 分解粒度以「**可独立评审、可独立回滚**」为标准；每个原子单元对应一个独立 Issue（标注变更类型与依赖顺序），一个 Issue 对应一个 PR。
- 分解方案（单元清单、类型、顺序、相互依赖）**必须**在实施开始前向维护者公示（Issues 即公示载体）；维护者可增删单元或调整顺序。
- 实施顺序按「**准则/文档先行 → 重构 → 功能**」排列，前序单元确立的规范约束作用于后续单元。
- 单元之间确有依赖需要堆叠分支时，PR 必须声明依赖顺序与建议合并次序。

## 4. Monorepo 与依赖管理

- **必须**遵循项目既定的工作区配置和依赖管理方式（Tau：pnpm workspace + `pnpm-workspace.yaml` catalog 单一来源，版本经 `catalog:` 引用）。
- **必须**将公共代码合理抽离至约定的共享目录（Tau：`packages/` 下的 `@tau/*` 工作区包），并保持职责清晰，避免重复；遵守包依赖方向（无环）。
- **必须**在依赖更新时：
  - 列出新增、升级、移除的依赖及原因。
  - 附上依赖安全扫描结果（`pnpm audit`；引入新包时额外说明替代方案为何不可行）。
  - 运行完整测试套件，并在 PR 中报告结果。
- **禁止**在未完成上述检查和报告的情况下提交依赖更新。
- **禁止**随意更改依赖管理策略或工作区结构，除非经维护者批准。

## 5. 文档同步与目录职责

- **必须**在每次代码变动后检查相关文档（双语 README、`docs/`、每个包的 README）是否需要更新。
- **必须**在 PR 描述（或 commit message）中明确说明文档更新情况；若无需更新，需说明理由。
- **必须**明确区分文档的目录职责：
  - **根目录**：全局性的 `README.md` / `README.zh-CN.md`、`CHANGELOG.md`、`AGENTS.md`。
  - **子包/模块目录**：`packages/<pkg>/README.md`（包公开 API）、`docs/`（人类向深度文档）、`AGENTS/`（分系统规则本）、`.claude/skills/`（dev-workflow 技能）。
  - 对应改动只落在对应层级，避免把包级细节写入根文档（或反之）。
- **禁止**在未同步文档的情况下提交会改变接口或行为的代码。
- 若 CI 配置了文档构建/格式检查（`pnpm format:check` 覆盖 Markdown），**必须**确保其通过。

## 6. 特殊标注（重构、架构调整）

- **必须**在 PR 标题开头添加固定标签：重构用 `[REFACTOR]`，架构调整用 `[ARCHITECTURE]`（commit message 仍按 Conventional Commits 用 `refactor:` 类型）。
- **必须**在描述中说明设计动机、影响范围和潜在风险。
- **禁止**自行合并此类 PR，必须等待至少一名核心成员人工审核通过。
- **必须**在提交前对重构或架构调整进行充分的代码结构梳理，并在描述中提供"结构影响说明"。

## 7. "AI 生成"标注

- **必须**在 PR 描述中显著注明"此 PR 由 AI 生成"。
- **必须**在每个 commit message 中统一添加 `AI-Generated: <简要说明>` 前缀行（位于标题与正文之后、`AI-declaration:` 尾注块之前），并保留既有的 `AI-declaration:` 尾注块（格式见 `.gitmessage` / AGENTS/release.md）。
- **禁止**省略或隐藏 AI 生成标注；人类作者的提交则**不得**添加这些标注。
- 若 CI 检查发现缺少 AI 标注，**必须**立即修正并重新推送。

## 8. Changelog 维护（按日更新至文件夹）

- **必须**在项目根目录维护 `changelog/` 文件夹，并**按日期**创建文件（如 `changelog/2026-09-01.md`）。
- **必须**在每天的工作结束后，将当日发生的所有变更（包括功能、修复、重构、文档更新等）记录到对应的每日 changelog 文件中。每日文件应包含：
  - 变更摘要
  - 变更类型（feature / fix / refactor / docs / chore 等）
  - 相关 Issue/PR 编号（如有）
  - 影响范围简述
- **禁止**将多天的变更混合记录在单个文件中。
- 同时维护根目录 `CHANGELOG.md`，作为重大版本发布的汇总，按需从每日 changelog 中提炼；**每个 PR 仍须**为 `CHANGELOG.md` 的 **Unreleased** 段填写片段（Keep a Changelog 分类：`Added` / `Changed` / `Fixed` / `Breaking` / `Removed`），与提交类型对应（`feature→Added`、`fix→Fixed`、`refactor→Changed`）。
- **禁止**提交不包含 Changelog 片段的 PR。

## 9. AGENTS.md 与 SKILL.md 更新

Tau 将"AI 行为准则"与"AI 可执行技能"分别存放：

- 新增或修改 **AI 行为准则、工作流程** → 更新 `AGENTS.md` 或 `AGENTS/` 对应规则本。
- 新增或修改 **AI 可执行技能、工具调用方式** → 更新 `.claude/skills/<name>/SKILL.md`（仓库根目录的 dev-workflow 技能，即本项目承载 SKILL.md 职责的位置）。
- 新增或修改**单包领域的工具技能**（仅与某一个包相关的知识）→ 更新 `packages/<pkg>/SKILL.md`（工具层，随包版本化维护）；如需保持根级触发词可发现性，可在 `.claude/skills/` 保留一个指向它的薄路由。三层归属模型以 `AGENTS/skills.md`（"SKILL.md files in THIS repo — three layers"）与 `AGENTS/architecture.md` 治理表为规范来源。
- **注意区分**：`packages/skills/bundled/` 与 `templates/` 下的 SKILL.md 是随 CLI 发售的**用户产品数据**（运行时数据，非代理技能），不属于上述任何一层，按产品内容层治理。
- 对于技术选型、工具链或工作流程的变化，**必须**同步更新 SKILL.md 中相关技能说明。
- **必须**在 PR 描述中说明是否涉及上述文件的更新，并列出具体修改内容。
- **禁止**在未检查这两处是否需要更新的情况下提交变更。

## 10. 死代码与硬编码逻辑清理

- **必须**在修改或新增代码时，检查并清除相关模块中的死代码（未被引用的变量、函数、文件、依赖等）。
- **必须**消除不必要的硬编码逻辑，将可配置项提取为常量、环境变量或配置文件，并保持默认行为不变。
- **禁止**在清理过程中改变其他无关功能的行为或引入回归。
- 若清理范围较大，应作为独立 PR 或 Issue 提交，并在描述中说明清理内容和验证方式。
- Tau 叠加约束：安全相关"表面上的死代码"（如 deny list 中暂无命中的模式、防御性检查）不是死代码——清理前先对照 `docs/safety.md` 与 AGENTS 黄金规则。

## 11. 测试与质量保障

- **必须**在代码变更后同步更新测试套件，确保覆盖新增功能和重构影响。
- **必须**运行完整测试套件并通过后方可提交，测试结果需在 PR 描述（或 commit message）中报告（Tau：`AI-gate:` 尾注 + PR 模板 "How it was tested" 勾选）。
- **禁止**在测试未通过或未运行的情况下提交变更。
- 若项目配置了架构测试、静态分析或 lint 工具（oxlint、`pnpm typecheck`、覆盖率阈值），**必须**保证其通过；覆盖率阈值只升不降。
- 若 CI 构建或测试失败，**必须**主动查找失败原因，解决具体问题（而不是绕过检查），并补充或修正测试用例，直到 CI 通过。

## 12. 合并权限与人工监督

- **禁止** AI 自行合并任何 PR，包括自己生成的 PR。
- **必须**等待指定维护者或核心成员审核批准后，由人工执行合并操作。
- 对于涉及架构、公共 API、安全模型（`packages/engine/src/safety.ts`、`runPlan` 执行通道、风险语义）或高风险改动的 PR，**必须**额外获得至少一名核心成员的明确批准。
- 直接 commit 的简单修复，也应遵循项目权限设置：Tau 的 `main` 受保护，因此即使简单修复也须经 PR 分支落地（见第 3 节）。

## 13. 流程自动化与审计

- **必须**遵守项目配置的自动化检查（`.github/workflows/ci.yml` 对 lint/typecheck/build/test:cov/audit 的强制；PR 模板对 AI 标注、Changelog 片段的检查）。
- **必须**保留所有操作的可追溯记录：提交信息（含 AI 标注尾注）、PR 描述、Issue 关联、评审评论、每日 changelog。
- **必须**在发现流程违规时主动纠正，并通知相关维护者；`git log --grep '^AI-declaration:' -E` 与 `git log --grep '^AI-Generated:' -E` 可枚举全部 AI 参与痕迹。

## 附：执行任何任务前的自检清单

- [ ] 是否已完成项目理解并形成结构化认知？
- [ ] 是否检查了 `AGENTS.md`（与 `AGENTS/`）和 SKILL.md（`.claude/skills/` 与 `packages/<pkg>/SKILL.md`）并确认是否需要更新？
- [ ] 是否根据变更类型选择了正确的流程（简单修复免 Issue 直接 commit（分支上），功能/重构走 Issue+PR）？
- [ ] 复合需求是否已自动分解并在实施前公示分解方案（一单元一 Issue 一 PR，见 §3）？
- [ ] 是否在 PR 描述或 commit 中包含 AI 标注、必要的结构影响说明？
- [ ] 是否更新了相关文档并明确了目录职责？
- [ ] 是否在 `changelog/` 文件夹中按日记录了当日变更？
- [ ] 是否清理了相关死代码和硬编码逻辑，且未改变其他功能？
- [ ] 是否运行并通过了全部测试？
- [ ] 若 CI 失败，是否已定位并解决具体问题，并完善测试？
- [ ] 是否等待人工审核，未自行合并？
