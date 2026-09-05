/**
 * Extracted stream/ui-state logic (issue #151) — the pure, DOM-free half
 * of the component extraction:
 *
 * - streamVolume: the autoscroll follow-volume over card state (result
 *   output + goal round step outputs) — ConversationStream watches this
 *   debounced to keep the newest output in view.
 * - useUiState: the overlay-switch state machine (shortcuts / settings)
 *   that ModalLayer renders and Esc closes.
 *
 * Both modules are Vue-client code but node-safe at import time (module
 * scope only creates refs — no DOM/localStorage access), so they unit
 * test without a browser.
 */

import { describe, it, expect } from "vitest";
import { streamVolume } from "../client/composables/plan-flow.js";
import { useUiState } from "../client/composables/ui-state.js";
import type { CardState } from "../client/composables/plan-flow.js";

const card = (c: CardState): CardState => c;

describe("streamVolume — autoscroll follow-volume", () => {
  it("is 0 for empty and non-streaming cards", () => {
    expect(streamVolume([])).toBe(0);
    expect(
      streamVolume([
        card({ type: "user", id: 1, text: "hello", ts: "2026-09-05T00:00:00Z" }),
        card({
          type: "plan",
          id: 2,
          intent: "i",
          plan: { explanation: "", steps: [] },
          review: { verdict: "allow", overallRisk: "low", issues: [] },
          provider: "mock",
          providerLabel: "Mock",
          warnings: [],
          running: false,
          confirmHighRisk: false,
          thinking: "some provider reasoning — not live output, does not count",
          thinkingMs: 5,
          streaming: true,
        }),
        card({ type: "error", id: 3, intent: "i", message: "boom" }),
      ]),
    ).toBe(0);
  });

  it("counts result card output", () => {
    expect(
      streamVolume([
        card({
          type: "result",
          id: 4,
          status: "ok",
          output: "0123456789",
          outcomes: [{ ok: true, skipped: false }],
          intent: "i",
        }),
      ]),
    ).toBe(10);
  });

  it("sums every goal round's step outputs", () => {
    expect(
      streamVolume([
        card({
          type: "goal",
          id: 5,
          goalId: "g1",
          intent: "i",
          provider: "mock",
          maxRounds: 3,
          streaming: true,
          status: "running",
          liveThinking: "",
          liveThinkingRound: 0,
          liveThinkingStartedAt: 0,
          rounds: [
            {
              round: 1,
              origin: "plan",
              approvalPending: false,
              thinking: "ignored",
              steps: [
                { index: 0, label: "file.find", output: "abcde", running: false },
                { index: 1, label: "shell", output: "xy", running: true },
              ],
            },
            {
              round: 2,
              origin: "reflect",
              approvalPending: false,
              thinking: "",
              steps: [{ index: 0, label: "file.read", output: "1234", running: false }],
            },
          ],
        }),
      ]),
    ).toBe(11);
  });

  it("accumulates across cards of all kinds", () => {
    const cards: CardState[] = [
      card({ type: "user", id: 1, text: "go", ts: "2026-09-05T00:00:00Z" }),
      card({
        type: "result",
        id: 2,
        status: "ok",
        output: "abcd",
        outcomes: [],
        intent: "go",
      }),
      card({
        type: "goal",
        id: 3,
        goalId: "g",
        intent: "go",
        provider: "mock",
        maxRounds: 2,
        streaming: false,
        status: "ok",
        answer: "not counted",
        liveThinking: "",
        liveThinkingRound: 0,
        liveThinkingStartedAt: 0,
        rounds: [
          {
            round: 1,
            origin: "plan",
            approvalPending: false,
            thinking: "",
            steps: [{ index: 0, label: "s", output: "abc", running: false }],
          },
        ],
      }),
    ];
    expect(streamVolume(cards)).toBe(7);
  });
});

describe("useUiState — overlay switch", () => {
  it("starts with every overlay closed", () => {
    const ui = useUiState();
    expect(ui.shortcutsOpen.value).toBe(false);
    expect(ui.settingsOpen.value).toBe(false);
  });

  it("opens surfaces independently", () => {
    const ui = useUiState();
    ui.shortcutsOpen.value = true;
    expect(ui.settingsOpen.value).toBe(false);
    ui.settingsOpen.value = true;
    expect(ui.shortcutsOpen.value).toBe(true);
  });

  it("closeOverlays closes both at once (the Esc path)", () => {
    const ui = useUiState();
    ui.shortcutsOpen.value = true;
    ui.settingsOpen.value = true;
    ui.closeOverlays();
    expect(ui.shortcutsOpen.value).toBe(false);
    expect(ui.settingsOpen.value).toBe(false);
  });

  it("is a module singleton — all mounts share one state", () => {
    const a = useUiState();
    const b = useUiState();
    a.settingsOpen.value = true;
    expect(b.settingsOpen.value).toBe(true);
    b.closeOverlays();
    expect(a.settingsOpen.value).toBe(false);
  });
});
