# AGENTS/collaboration.md — AI 助手代码协作操作规范

> **Language note / 语言说明**: this rulebook is normative in Chinese by
> maintainer decision (it transcribes the maintainer's collaboration
> contract verbatim). The English TL;DR below is a convenience summary —
> where the two disagree, the Chinese text wins.
> **本文件为 AI 协作的强制规范。** Every AI agent working in this repo MUST
> read and follow it; it overrides habits from other projects. Source of
> authority: the maintainer's collaboration directive, adopted 2026-08.

## English TL;DR (non-normative)

1. Understand the project systemically before touching code; keep docs in sync.
2. Every change needs an Issue first; one PR = one Issue; PR body references it (`Closes #N`).
3. Dependency updates are standalone PRs with add/upgrade/remove lists, `pnpm audit` results, and full test results.
4. Docs must be synced in the same PR (both READMEs, AGENTS, docs/); state doc status in the PR body.
5. Refactors / architecture changes: `[REFACTOR]` / `[ARCHITECTURE]` tag in PR title, motivation + impact + risk + structure-impact statement, and NEVER self-merge.
6. Every AI PR body prominently notes "此 PR 由 AI 生成"; every AI commit message carries the `AI-Generated: <说明>` prefix line AND the `AI-declaration:` trailer block (see AGENTS/release.md / .gitmessage).
7. Every PR carries a `CHANGELOG.md` Unreleased fragment (feature / fix / refactor / docs …).
8. Behavior-rule changes → update `AGENTS.md`/`AGENTS/`; executable-skill changes → update `.claude/skills/`.
9. Every PR includes a structure-impact statement (modules, dependency changes, coupling risks).
10. AI never merges any PR (including its own); human review is mandatory; high-risk/architecture PRs need an extra explicit core-member approval.
11. Respect configured automation; keep every action traceable; self-correct violations and notify the maintainer.

---

## 1. 项目理解与文档初始化/更新

- **必须**在接手新项目或分析原有项目时，首先进行系统性理解，包括但不限于：
  - 代码结构、模块划分、依赖关系
  - 构建、测试、部署流程
  - 现有文档（README、CHANGELOG、AGENTS.md、`.claude/skills/` 等）及覆盖程度
  - 项目约定（代码风格、分支策略、提交规范等）
- **必须**基于理解结果，判断项目是否缺失 `CHANGELOG.md`、`AGENTS.md` 或相关文档，并酌情补充；若已有这些文件，检查其内容是否与当前代码一致，过时则提出更新。
- **必须**形成结构化认知（架构、关键模块、核心流程、风险点），不得机械照搬现有描述；Tau 的入口是 `AGENTS.md` + `AGENTS/` 规则本。
- **禁止**在不理解项目背景和结构的情况下直接进行代码修改或提交 PR。
- **必须**保证文档更新与代码变动同步，任何影响接口、行为、架构的改动都必须同步更新相关文档。

## 2. 提交 Issue 与 PR 的流程

- **必须**在每次代码合并前，先创建或关联对应的 Issue。
- **必须**确保一个 PR 只对应一个 Issue，禁止将多个不相关改动混入同一 PR。
- **必须**在 PR 描述中引用 Issue 编号（如 `Closes #123`），并保持描述清晰完整（What & why / 如何测试 / 结构影响说明 / 文档更新情况）。

## 3. 依赖更新管理

- **必须**将依赖更新（`package.json`、`pnpm-workspace.yaml` catalog）作为独立 PR 提交，不得与其他功能改动混合。
- **必须**在 PR 描述中列出新增、升级、移除的依赖及原因，并附上依赖安全扫描结果（`pnpm audit`；引入新包时额外说明替代方案为何不可行）。
- **必须**在提交依赖更新前运行完整测试套件，并在 PR 中报告测试结果。
- **禁止**在未完成上述检查和报告的情况下提交依赖更新。
- Tau 特有约束叠加：运行时依赖冻结（AGENTS.md 黄金规则 4），版本一律走 `pnpm-workspace.yaml` 的 `catalog:` 单一来源。

## 4. 文档同步

- **必须**在每次代码变动后检查相关文档（双语 README、`docs/`、每个包的 README）是否需要更新。
- **必须**在 PR 描述中明确说明文档更新情况；若无需更新，需说明理由。
- **禁止**在未同步文档的情况下提交会改变接口或行为的代码。
- 若 CI 配置了文档构建/格式检查（`pnpm format:check` 覆盖 Markdown），**必须**确保其通过。

## 5. 特殊标注（重构、架构调整）

- **必须**在 PR 标题开头添加固定标签：重构用 `[REFACTOR]`，架构调整用 `[ARCHITECTURE]`（commit message 仍按 Conventional Commits 用 `refactor:` 类型）。
- **必须**在描述中说明设计动机、影响范围和潜在风险。
- **禁止**自行合并此类 PR，必须等待至少一名核心成员人工审核通过。
- **必须**在提交前对重构或架构调整进行充分的代码结构梳理，并在描述中提供"结构影响说明"。

## 6. "AI 生成"标注

- **必须**在 PR 描述中显著注明"此 PR 由 AI 生成"。
- **必须**在每个 commit message 中统一添加 `AI-Generated: <简要说明>` 前缀行（位于标题与正文之后、`AI-declaration:` 尾注块之前），并保留既有的 `AI-declaration:` 尾注块（格式见 `.gitmessage` / AGENTS/release.md）。
- **禁止**省略或隐藏 AI 生成标注；人类作者的提交则**不得**添加这些标注。
- 若 CI 检查发现缺少 AI 标注，**必须**立即修正并重新推送。

## 7. Changelog 维护

- **必须**在每个 PR 中为 `CHANGELOG.md` 的 **Unreleased** 段填写片段，描述本次变动的用户可见影响或重要技术变更。
- **必须**使用 Keep a Changelog 分类（`Added` / `Changed` / `Fixed` / `Breaking` / `Removed`），与提交类型 `feature→Added`、`fix→Fixed`、`refactor→Changed` 对应。
- **禁止**提交不包含 Changelog 片段的 PR。

## 8. AGENTS.md 与 `.claude/skills/` 更新

Tau 将"AI 行为准则"与"AI 可执行技能"分别存放：

- 新增或修改 **AI 行为准则、工作流程** → 更新 `AGENTS.md` 或 `AGENTS/` 对应规则本。
- 新增或修改 **AI 可执行技能、工具调用方式** → 更新 `.claude/skills/<name>/SKILL.md`（仓库根目录的 dev-workflow 技能，即本项目承载 SKILL.md 职责的位置）。
- 新增或修改**单包领域的工具技能**（仅与某一个包相关的知识）→ 更新 `packages/<pkg>/SKILL.md`（工具层，随包版本化维护）；如需保持根级触发词可发现性，可在 `.claude/skills/` 保留一个指向它的薄路由。三层归属模型以 `AGENTS/skills.md`（"SKILL.md files in THIS repo — three layers"）与 `AGENTS/architecture.md` 治理表为规范来源。
- **注意区分**：`packages/skills/bundled/` 与 `templates/` 下的 SKILL.md 是随 CLI 发售的**用户产品数据**（运行时数据，非代理技能），不属于上述任何一层，按产品内容层治理。
- **必须**在 PR 描述中说明是否涉及上述文件的更新，并列出具体修改内容。
- **禁止**在未检查这两处是否需要更新的情况下提交 PR。

## 9. 代码结构梳理与审查

- **必须**在每个 PR 描述中提供"结构影响说明"，包括：
  - 新增/修改的模块及职责
  - 依赖关系变化（含是否触碰 catalog / 运行时依赖冻结）
  - 潜在耦合点或风险
- **必须**确保代码结构清晰，不引入不必要的复杂度；遵守包依赖方向（无环）。
- 若项目配置了静态分析工具（oxlint、`pnpm typecheck`、架构约定测试），**必须**保证其通过。

## 10. 合并权限与人工监督

- **禁止** AI 自行合并任何 PR，包括自己生成的 PR。
- **必须**等待指定维护者或核心成员审核批准后，由人工执行合并操作。
- 对于涉及架构、公共 API、安全模型（`packages/engine/src/safety.ts`、`runPlan` 执行通道、风险语义）或高风险改动的 PR，**必须**额外获得至少一名核心成员的明确批准。

## 11. 流程自动化与审计

- **必须**遵守项目配置的自动化检查（`.github/workflows/ci.yml` 对 lint/typecheck/build/test:cov/audit 的强制）。
- **必须**保留所有操作的可追溯记录：提交信息（含 AI 标注尾注）、PR 描述、Issue 关联、评审评论。
- **必须**在发现流程违规时主动纠正，并通知相关维护者；`git log --grep '^AI-declaration:' -E` 与 `git log --grep '^AI-Generated:' -E` 可枚举全部 AI 参与痕迹。
