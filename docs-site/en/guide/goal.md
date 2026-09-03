# Multi-round agent (tau goal)

`tau goal` turns Tau from a single-round diagnostician into a task agent: one intent can span up to five reviewed rounds — plan, run, reflect, repeat — with every round passing the same deterministic review, and the provider deciding after each round whether the goal is done.

## Basic usage

```bash
tau goal "collect every TODO comment into a checklist file"
tau goal "refactor this script" --rounds 4
```

The round cap defaults to 3, is tunable with `--rounds`, and hard-ceils at 5. Caps guard against runaway loops; every proposed next-round plan must pass the safety review before it can run.

## Life of a round

1. **round_plan**: the provider produces a plan (or a reflection continues with one), graded by the deterministic `reviewPlan()`.
2. **approval**: non-low-risk rounds pause for your explicit approval — agent mode is never a blanket pre-authorization.
3. **execute**: through the only execution channel, `runPlan()`; shell steps are cancellable end-to-end (abort kills the whole process group).
4. **reflect**: the provider receives the executed rounds (outputs truncated to 4k chars each) and answers "done (with a final answer)" or "one more round (with a plan)". A reflected plan is ALWAYS re-graded — the AI never grades itself.

Round history in the prompt is capped (last 3 verbatim, older rounds summarized in one line) so long goals cannot blow the context.

## Streaming thinking (v0.5.0)

In the WebUI agent mode, each round's planning thinking streams live: planning thinking and reflection thinking are tagged to their own rounds' collapsible panels. The CLI can consume round-tagged thinking deltas through the goal stream events.

## Providers without reflection

`reflect()` is an optional capability. mock, OpenAI-compatible, Anthropic and Gemini implement it; Ollama, DeepSeek and Zai do not yet — they degrade honestly to a single executed round with a note, never silently pretending to be done.
