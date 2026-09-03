# Single-round Q&A (tau ask)

`tau ask` is Tau's historical front door: one intent in, one plan, one execution, one result out. It fits tasks that complete in a single step or a fixed sequence — "find this", "look that up", "read this file".

## Basic usage

```bash
tau ask "find log files larger than 1MB"
tau ask "read package.json and summarize the dependencies"
```

You will see the AI's planning explanation, every step (tool or shell command), the deterministic review verdict, and a confirmation request (low-risk read-only plans can skip interaction with `--yes`).

## Streaming thinking (v0.5.0)

Since v0.5.0, the planning turn can stream the provider's thinking as it happens (reasoning deltas): DeepSeek's `reasoning_content`, Anthropic's `thinking_delta` and Gemini's thought parts arrive on a separate channel from the plan text. The assembled plan still passes the exact same strict-JSON validation and deterministic review as buffered mode — streaming changes when you see things, never what can execute.

This capability currently surfaces in the **WebUI**: while planning, thinking streams live into the collapsible panel at the top of the plan card. The CLI does not expose a `--stream` flag yet — the library APIs (`planIntentStream` / `onPlanStream`) are ready for custom integrations.

## tau ask vs tau goal

|            | tau ask                 | tau goal                              |
| ---------- | ----------------------- | ------------------------------------- |
| Rounds     | 1                       | up to 5 (default 3)                   |
| Reflection | none                    | provider decides after each round     |
| Best for   | clear single-step tasks | tasks that adapt to their own results |

`tau ask` ends when the execution ends. If the provider thinks another round would help, that is [tau goal](/en/guide/goal)'s job.

## Exit codes and pipes

`tau ask` follows Unix conventions: 0 on success, non-zero on failure, results on stdout, logs on stderr — ready for pipes and CI scripts.
