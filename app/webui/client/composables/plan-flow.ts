/**
 * Agent store — local conversation threads + the shared intent → plan →
 * review → execute flow, persisted to localStorage (the server history stays
 * the durable record; threads are a UI convenience). Module-singleton like
 * session.ts: every mount shares the same refs.
 *
 * The execute gate mirrors the server contract: deny verdicts can't run,
 * high-risk plans require the card-local explicit checkbox (per-card state —
 * the old global `#confirm-high-risk` ID collided across concurrent plans).
 * Nothing here bypasses the pipeline: plan comes from /api/plan, execution
 * from /api/execute — the same runPlan() channel the CLI uses.
 */
import { computed, reactive, ref, watch } from "vue";
import { postJson, type PlanResponse } from "../lib/api.js";
import { postNdjson, type StreamEvent } from "../lib/stream.js";
import { useSession } from "./session.js";

export interface UserCardState {
  type: "user";
  id: number;
  text: string;
  ts: string;
}

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
  /** True while the NDJSON stream is still delivering events. */
  streaming?: boolean;
}

export interface ErrorCardState {
  type: "error";
  id: number;
  intent: string;
  message: string;
}

export type CardState = UserCardState | PlanCardState | ResultCardState | ErrorCardState;

export interface Thread {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  cards: CardState[];
}

const STORAGE_KEY = "tau-webui-threads-v1";
/** Pinned contract (DESIGN.md §9): the local thread cap. */
export const MAX_THREADS = 50;
const TITLE_CAP = 42;

function loadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is Thread =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as Thread).id === "number" &&
        Array.isArray((t as Thread).cards),
    );
  } catch {
    return [];
  }
}

function persist(threads: Thread[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
  } catch {
    // Storage unavailable (private mode/quota) — threads stay in-memory only.
  }
}

function threadTitle(cards: CardState[]): string {
  const first = cards.find((c): c is UserCardState => c.type === "user");
  const text = first?.text ?? "new conversation";
  return text.length > TITLE_CAP ? `${text.slice(0, TITLE_CAP)}…` : text;
}

const threads = ref<Thread[]>([]);
const currentId = ref<number>(0);
const planning = ref(false);
let nextId = 1;
let initialized = false;

function now(): string {
  return new Date().toISOString();
}

function touch(thread: Thread): void {
  thread.updatedAt = now();
}

export function usePlanFlow() {
  const { refreshHistory } = useSession();

  if (!initialized) {
    initialized = true;
    threads.value = loadThreads();
    nextId = threads.value.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    if (threads.value.length === 0) {
      const thread: Thread = {
        id: nextId++,
        title: "new conversation",
        createdAt: now(),
        updatedAt: now(),
        cards: [],
      };
      threads.value = [thread];
      currentId.value = thread.id;
    } else {
      currentId.value = threads.value[0]?.id ?? 0;
    }
    watch(threads, () => persist(threads.value), { deep: true });
  }

  const currentThread = computed<Thread | undefined>(
    () => threads.value.find((t) => t.id === currentId.value) ?? threads.value[0],
  );

  const cards = computed<CardState[]>(() => currentThread.value?.cards ?? []);

  function createThread(): void {
    const thread: Thread = {
      id: nextId++,
      title: "new conversation",
      createdAt: now(),
      updatedAt: now(),
      cards: [],
    };
    threads.value = [thread, ...threads.value].slice(0, MAX_THREADS);
    currentId.value = thread.id;
  }

  function switchThread(id: number): void {
    if (threads.value.some((t) => t.id === id)) currentId.value = id;
  }

  function removeThread(id: number): void {
    threads.value = threads.value.filter((t) => t.id !== id);
    if (currentId.value === id) {
      if (threads.value.length === 0) {
        createThread();
      } else {
        currentId.value = threads.value[0]?.id ?? 0;
      }
    }
  }

  /** The thread that currently owns a card (cards never cross threads). */
  function ownerOf(card: CardState): Thread | undefined {
    return threads.value.find((t) => t.cards.includes(card));
  }

  function submitIntent(intent: string): void {
    const thread = currentThread.value;
    if (!thread) return;
    thread.cards.push({ type: "user", id: nextId++, text: intent, ts: now() });
    thread.title = threadTitle(thread.cards);
    touch(thread);
    planning.value = true;
    void (async () => {
      try {
        const data = await postJson<PlanResponse>("/api/plan", { intent });
        // reactive() so post-push mutations (card.running during execute)
        // go through the proxy — raw-object writes bypass reactivity and
        // leave dependent computeds cached at their stale value.
        thread.cards.push(
          reactive({
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
          }) as PlanCardState,
        );
      } catch (error) {
        thread.cards.push({
          type: "error",
          id: nextId++,
          intent,
          message: (error as Error).message,
        });
      } finally {
        planning.value = false;
        touch(thread);
      }
    })();
  }

  /**
   * Execute via the NDJSON streaming endpoint: a live result card appears
   * immediately and grows as step events arrive (step_output chunks append,
   * step_end tallies outcomes). The final aggregated `result` event is the
   * authoritative state — it overwrites the incremental view. Any transport
   * failure falls back to the error-card contract. Same gates as before:
   * the stream endpoint re-runs reviewPlan and runPlan re-reviews inside
   * the engine — nothing bypasses the pipeline.
   */
  async function runPlan(card: PlanCardState): Promise<void> {
    const thread = ownerOf(card);
    card.running = true;
    // reactive() so the streaming mutations below (step chunks, the
    // authoritative result event, the streaming flag) trigger the render
    // pipeline — raw writes bypass the proxy and the rendered markdown
    // preview stays cached at its initial empty value.
    const resultCard = reactive({
      type: "result",
      id: nextId++,
      status: "running",
      output: "",
      outcomes: [],
      intent: card.intent,
      streaming: true,
    }) as ResultCardState;
    thread?.cards.push(resultCard);
    try {
      await postNdjson(
        "/api/execute/stream",
        {
          intent: card.intent,
          plan: card.plan,
          provider: card.provider,
          confirmHighRisk: card.confirmHighRisk,
        },
        (event: StreamEvent) => {
          const type = event["type"];
          if (type === "step_output" && typeof event["chunk"] === "string") {
            resultCard.output += event["chunk"];
          } else if (type === "step_end") {
            resultCard.outcomes.push({
              ok: event["ok"] === true,
              skipped: event["skipped"] === true,
            });
          } else if (type === "result") {
            // authoritative final state
            if (typeof event["status"] === "string") resultCard.status = event["status"];
            if (typeof event["output"] === "string" && event["output"]) {
              resultCard.output = event["output"];
            }
            if (Array.isArray(event["outcomes"])) {
              resultCard.outcomes = (
                event["outcomes"] as { ok?: boolean; skipped?: boolean }[]
              ).map((o) => ({ ok: o.ok === true, skipped: o.skipped === true }));
            }
          } else if (type === "error") {
            resultCard.status = "failed";
            if (!resultCard.output) {
              resultCard.output = `stream error: ${String(event["error"] ?? "unknown")}`;
            }
          }
        },
      );
      if (resultCard.output === "") resultCard.output = "(no output)";
    } catch (error) {
      // Transport-level failure: replace the live card with the error card.
      const owner = thread ?? ownerOf(resultCard);
      if (owner) owner.cards = owner.cards.filter((c) => c !== resultCard);
      thread?.cards.push({
        type: "error",
        id: nextId++,
        intent: card.intent,
        message: (error as Error).message,
      });
    } finally {
      resultCard.streaming = false;
      dropCard(card);
      card.running = false;
      if (thread) touch(thread);
      void refreshHistory();
    }
  }

  function dropCard(card: CardState): void {
    const owner = ownerOf(card);
    if (!owner) return;
    owner.cards = owner.cards.filter((c) => c !== card);
    touch(owner);
  }

  return {
    threads,
    currentId,
    currentThread,
    cards,
    planning,
    submitIntent,
    runPlan,
    discard: dropCard,
    createThread,
    switchThread,
    removeThread,
  };
}
