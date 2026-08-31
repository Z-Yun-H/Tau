/**
 * Plan flow state machine — the intent → plan → review → execute column.
 * The execute gate mirrors the server contract: deny verdicts can't run,
 * high-risk plans require the card-local explicit checkbox (per-card state —
 * the old global `#confirm-high-risk` ID collided across concurrent plans).
 */
import { ref } from "vue";
import { postJson, type ExecuteResponse, type PlanResponse } from "../lib/api.js";
import { useSession } from "./session.js";

export interface PlanCardState {
  type: "plan";
  id: number;
  intent: string;
  plan: PlanResponse["plan"];
  review: PlanResponse["review"];
  provider: string;
  providerLabel: string;
  warnings: string[];
  running: boolean;
  /** Card-local explicit confirmation for high-risk execution. */
  confirmHighRisk: boolean;
}

export interface ResultCardState {
  type: "result";
  id: number;
  status: string;
  output: string;
  outcomes: { ok: boolean; skipped: boolean }[];
  intent: string;
}

export interface ErrorCardState {
  type: "error";
  id: number;
  intent: string;
  message: string;
}

export type CardState = PlanCardState | ResultCardState | ErrorCardState;

let nextId = 1;

export function usePlanFlow() {
  const cards = ref<CardState[]>([]);
  const planning = ref(false);
  const { refreshHistory } = useSession();

  function remove(card: CardState): void {
    cards.value = cards.value.filter((c) => c !== card);
  }

  async function submitIntent(intent: string): Promise<void> {
    planning.value = true;
    try {
      const data = await postJson<PlanResponse>("/api/plan", { intent });
      cards.value.push({
        type: "plan",
        id: nextId++,
        intent: data.intent,
        plan: data.plan,
        review: data.review ?? { verdict: "allow", overallRisk: "low", issues: [] },
        provider: data.provider,
        providerLabel: data.providerLabel,
        warnings: data.warnings ?? [],
        running: false,
        confirmHighRisk: false,
      });
    } catch (error) {
      cards.value.push({ type: "error", id: nextId++, intent, message: (error as Error).message });
    } finally {
      planning.value = false;
    }
  }

  async function runPlan(card: PlanCardState): Promise<void> {
    card.running = true;
    try {
      const result = await postJson<ExecuteResponse>("/api/execute", {
        intent: card.intent,
        plan: card.plan,
        provider: card.provider,
        confirmHighRisk: card.confirmHighRisk,
      });
      cards.value.push({
        type: "result",
        id: nextId++,
        status: result.status,
        output: result.output || "(no output)",
        outcomes: (result.outcomes ?? []).map((o) => ({ ok: o.ok, skipped: o.skipped })),
        intent: card.intent,
      });
      remove(card);
    } catch (error) {
      cards.value.push({
        type: "error",
        id: nextId++,
        intent: card.intent,
        message: (error as Error).message,
      });
      remove(card);
    } finally {
      card.running = false;
      void refreshHistory();
    }
  }

  return { cards, planning, submitIntent, runPlan, discard: remove };
}
