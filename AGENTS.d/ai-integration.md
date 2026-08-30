# AGENTS.d/ai-integration.md — providers, prompts, and the safety boundary

## Provider interface (src/types.ts AIProvider)

```ts
interface AIProvider {
  readonly name: string; // registry key: "mock" | "ollama" | "openai" | "zai"
  readonly label: string; // CLI display
  isAvailable(): Promise<boolean>;
  unavailableReason?(): string;
  plan(ctx: PlanningContext): Promise<Plan>;
}
```

Registration: `src/ai/registry.ts registerProvider(...)`. Config defaults per
provider: `DEFAULT_CONFIG.providers` in `src/config/store.ts`.

Selection precedence: `--provider` flag > `TAU_PROVIDER` env > `config.provider`

> mock fallback. An unknown name silently falls back to mock — intentional:
> the CLI must never hard-fail on config drift.

## The plan contract

Providers answer STRICT JSON:

```json
{
  "explanation": "string",
  "steps": [{ "kind": "tool", "tool": "file.find", "args": {}, "reason": "..." }],
  "selfAssessedRisk": "low|medium|high"
}
```

`validatePlanResponse()` (src/ai/prompt.ts) is tolerant about WRAPPING
(code fences, prose around JSON) and strict about CONTENT (zod `.strict()`).
Changes to the schema must update: planSchema + reviewPlan expectations +
mock provider + tests + this file + README example.

## System prompt (buildSystemPrompt)

- Injects the REAL tool catalog (renderToolCatalog) and skill catalog — the
  planner can only propose tools that actually exist, and the reviewer
  independently enforces that. Keep both sides in sync.
- Explicit rules: prefer tools over shell, prefer dry-run first, no invented
  tool names, ≤10 steps, JSON only.
- Keep the prompt deterministic for a given catalog (no timestamps, no
  randomness) so tests can assert on it.

## Adding a provider — checklist

1. `src/ai/providers/<name>.ts` implementing AIProvider (look at openai.ts
   for the HTTP pattern; ollama.ts for local-server availability probing).
2. Register in `registry.ts`; add config defaults in `store.ts`.
3. `isAvailable()` must be CHEAP and never prompt; `unavailableReason()`
   explains exactly what to install/export.
4. Tests: request shaping + response parsing with a mocked `chatJSON`/fetch.
   Never hit real endpoints in CI.
5. Update README (both languages) provider table + `tau config list` output
   if it changes.

## Safety boundary — the part you must not weaken

- `reviewPlan()` (src/core/safety.ts) runs AFTER the provider and BEFORE any
  confirmation/execution. It is deterministic and has no AI involvement.
- `DENY_PATTERNS` → verdict deny (exit code 2). `CAUTION_PATTERNS` → high
  risk (interactive confirm required; `--yes` refuses to auto-run high).
- `blocked` is final: no flag, no config, no provider output overrides it.
- If you add a pattern, add the matching test pair (positive + benign
  near-miss). Over-blocking is a bug too: a pattern that matches `curl` docs
  text makes the tool worse.
- Execution limits: timeout from config (default 30s), output cap 200k chars,
  plan ≤10 steps, shell command ≤2000 chars.

## Secret hygiene

- API keys come from environment (OPENAI_API_KEY, ZAI config) — never stored
  in config.json by Tau itself, never logged, never echoed into prompts.
- Provider errors may contain server messages: truncate to ~300 chars before
  displaying (chatJSON already does).
