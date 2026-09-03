# Safety model

Tau's safety design compresses to one sentence: **the AI proposes, rules review, the human decides.** Every mechanism is deterministic code — there is no "the AI thinks it's fine" anywhere.

## Three gates

1. **Plan validation** — provider output must be strict JSON (zod schema, `additionalProperties: false`); loose output (code fences, extra fields) is rejected outright.
2. **Deterministic review** — `reviewPlan()` grades the plan by rules: allow / review / deny, with itemized issues. The reviewer independently re-checks every write path, forming defense in depth with the tool's own checks.
3. **Execution confirmation** — deny never runs; high-risk demands explicit confirmation (CLI interactive, WebUI card-local checkbox); medium writes default to dry-run and need `execute: true`; in agent mode medium+ rounds pause inline for approval — **there is never a blanket pre-approval**.

## One execution channel

`runPlan()` is the only execution channel, and it reviews **again** inside. Every front door (CLI/TUI/WebUI), every mode (ask/goal), every provider converges here. There is no "provider runs a command directly" path.

## Concrete hard edges

- **No delete tool**: the first-party family deliberately ships no delete primitive.
- **Workspace containment**: `file.write` refuses workspace escapes and system locations (`/etc`, `/usr`, …), binary targets and >2MB content.
- **Plugin tools always medium**: external MCP tools cannot be audited internally, and their risk never grades below medium regardless of what they declare.
- **Cancellable shell steps**: abort kills the whole process group — no orphan processes.
- **The AI never grades itself**: reflected next-round plans pass the same deterministic review; reflection proposes, the review decides.

## Streaming never weakens safety (v0.5.0)

Streaming changes when text arrives, not how it is handled: a streamed plan still passes the same `validatePlanResponse()` and `reviewPlan()`; refusals happen before the stream starts (plain JSON errors). There is no "streaming bypasses the review" shape.

## Observability

One structured log line per request (including AI token cost); the WebUI settings panel shows only redacted config — API keys never appear in plaintext in logs or the browser.
