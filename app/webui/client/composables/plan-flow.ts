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
import { computed, ref, watch } from "vue";
import { postJson, type ExecuteResponse, type PlanResponse } from "../lib/api.js";
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
const MAX_THREADS = 50;
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
        thread.cards.push({
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

  async function runPlan(card: PlanCardState): Promise<void> {
    const thread = ownerOf(card);
    card.running = true;
    try {
      const result = await postJson<ExecuteResponse>("/api/execute", {
        intent: card.intent,
        plan: card.plan,
        provider: card.provider,
        confirmHighRisk: card.confirmHighRisk,
      });
      thread?.cards.push({
        type: "result",
        id: nextId++,
        status: result.status,
        output: result.output || "(no output)",
        outcomes: (result.outcomes ?? []).map((o) => ({ ok: o.ok, skipped: o.skipped })),
        intent: card.intent,
      });
      dropCard(card);
    } catch (error) {
      thread?.cards.push({
        type: "error",
        id: nextId++,
        intent: card.intent,
        message: (error as Error).message,
      });
      dropCard(card);
    } finally {
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
