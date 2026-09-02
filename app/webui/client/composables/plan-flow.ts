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

/** One live step inside a goal round (streamed output grows into `output`). */
export interface GoalStepState {
  index: number;
  label: string;
  output: string;
  running: boolean;
  ok?: boolean;
  skipped?: boolean;
}

/** One round of a goal: plan + review + live steps + terminal status. */
export interface GoalRoundState {
  round: number;
  origin: "plan" | "reflect";
  plan?: PlanResponse["plan"];
  review?: PlanResponse["review"];
  steps: GoalStepState[];
  status?: string;
  /** True while the stream is paused on /api/goal/approve for this round. */
  approvalPending: boolean;
  approvalTimedOut?: boolean;
}

/** Agent-mode card: a multi-round goal over /api/goal/stream (issue #97). */
export interface GoalCardState {
  type: "goal";
  id: number;
  goalId: string;
  intent: string;
  provider: string;
  maxRounds: number;
  rounds: GoalRoundState[];
  status: "running" | "ok" | "failed" | "cancelled" | "denied" | "max_rounds";
  answer?: string;
  error?: string;
  /** True while the NDJSON stream is still delivering events. */
  streaming: boolean;
}

export type CardState =
  | UserCardState
  | PlanCardState
  | ResultCardState
  | ErrorCardState
  | GoalCardState;

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

/**
 * Live abort controllers for running goals — deliberately OUT of the card
 * state: cards persist to localStorage, controllers must not. Keyed by
 * card id; cancelled on Stop and cleared once the stream settles.
 */
const goalControllers = new Map<number, AbortController>();

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

/**
 * Post-load migration: a goal that was `running` when the tab closed can
 * never resume — its stream is gone. Mark those honestly instead of
 * rendering a zombie spinner forever (threads persist across reloads).
 */
function settleOrphanGoals(threads: Thread[]): void {
  for (const thread of threads) {
    for (const card of thread.cards) {
      if (card.type === "goal" && card.status === "running") {
        card.status = "cancelled";
        card.streaming = false;
        card.error = "session ended before the goal finished";
        for (const round of card.rounds ?? []) {
          round.approvalPending = false;
          for (const step of round.steps ?? []) step.running = false;
        }
      }
    }
  }
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
    settleOrphanGoals(threads.value);
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

  /** Human-readable one-line step label for live goal rows. */
  function stepLabel(step: {
    kind?: string;
    tool?: string;
    command?: string;
    args?: Record<string, unknown>;
  }): string {
    if (step.kind === "tool") {
      return `tool ${step.tool ?? "?"} ${JSON.stringify(step.args ?? {})}`;
    }
    return `shell $ ${step.command ?? ""}`;
  }

  /**
   * Agent mode (issue #97): run a multi-round goal over /api/goal/stream.
   * The goal card grows live: rounds appear as round_plan arrives, step
   * output streams into the active row, approval pauses surface inline
   * (medium+ rounds NEVER auto-run — the card shows Approve/Stop). Every
   * round is engine-reviewed exactly like the plan flow; nothing here
   * bypasses runPlan.
   */
  function submitGoal(intent: string, provider?: string): void {
    const thread = currentThread.value;
    if (!thread) return;
    thread.cards.push({ type: "user", id: nextId++, text: intent, ts: now() });
    thread.title = threadTitle(thread.cards);
    touch(thread);

    const card = reactive({
      type: "goal",
      id: nextId++,
      goalId: "",
      intent,
      provider: provider ?? "",
      maxRounds: 0,
      rounds: [],
      status: "running",
      streaming: true,
    }) as GoalCardState;
    thread.cards.push(card);

    const controller = new AbortController();
    goalControllers.set(card.id, controller);
    let currentRound: GoalRoundState | undefined;

    const lastStep = (): GoalStepState | undefined => currentRound?.steps.at(-1);

    void (async () => {
      try {
        await postNdjson(
          "/api/goal/stream",
          { intent, ...(provider ? { provider } : {}) },
          (event: StreamEvent) => {
            const type = event["type"];
            if (type === "goal_registered" && typeof event["goalId"] === "string") {
              card.goalId = event["goalId"];
            } else if (type === "goal_start") {
              if (typeof event["maxRounds"] === "number") card.maxRounds = event["maxRounds"];
              if (typeof event["provider"] === "string" && !card.provider) {
                card.provider = event["provider"];
              }
            } else if (type === "round_plan") {
              const round: GoalRoundState = {
                round: typeof event["round"] === "number" ? event["round"] : card.rounds.length + 1,
                origin: event["origin"] === "reflect" ? "reflect" : "plan",
                plan: event["plan"] as PlanResponse["plan"] | undefined,
                review: event["review"] as PlanResponse["review"] | undefined,
                steps: [],
                approvalPending: false,
              };
              card.rounds.push(round);
              currentRound = round;
            } else if (type === "step_start" && currentRound) {
              currentRound.steps.push({
                index:
                  typeof event["index"] === "number" ? event["index"] : currentRound.steps.length,
                label: stepLabel((event["step"] ?? {}) as Record<string, string>),
                output: "",
                running: true,
              });
            } else if (type === "step_output" && typeof event["chunk"] === "string") {
              const step = lastStep();
              if (step) step.output += event["chunk"];
            } else if (type === "step_end") {
              const step = lastStep();
              if (step) {
                step.running = false;
                step.ok = event["ok"] === true;
                step.skipped = event["skipped"] === true;
              }
            } else if (type === "round_end" && currentRound) {
              if (typeof event["status"] === "string") currentRound.status = event["status"];
            } else if (type === "approval_required" && currentRound) {
              currentRound.approvalPending = true;
            } else if (type === "approval_timeout" && currentRound) {
              currentRound.approvalPending = false;
              currentRound.approvalTimedOut = true;
            } else if (type === "goal_end") {
              if (typeof event["status"] === "string") {
                card.status = event["status"] as GoalCardState["status"];
              }
              if (typeof event["answer"] === "string") card.answer = event["answer"];
              if (typeof event["error"] === "string") card.error = event["error"];
            } else if (type === "error") {
              card.status = "failed";
              card.error = `stream error: ${String(event["error"] ?? "unknown")}`;
            }
          },
          controller.signal,
        );
      } catch (error) {
        if (card.status === "running") {
          const aborted = controller.signal.aborted;
          card.status = aborted ? "cancelled" : "failed";
          card.error = aborted ? "stopped by user" : (error as Error).message;
        }
      } finally {
        card.streaming = false;
        goalControllers.delete(card.id);
        for (const round of card.rounds) {
          round.approvalPending = false;
          for (const step of round.steps) step.running = false;
        }
        if (thread) touch(thread);
        void refreshHistory();
      }
    })();
  }

  /** Decide a paused round (approve=true resumes; false ends cancelled). */
  async function approveGoal(card: GoalCardState, approved: boolean): Promise<void> {
    const round = card.rounds.find((r) => r.approvalPending);
    if (round) round.approvalPending = false; // optimistic; stream confirms
    try {
      await postJson("/api/goal/approve", { goalId: card.goalId, approve: approved });
    } catch {
      // 404/expired: the stream itself ends the goal — nothing to do here.
    }
  }

  /** Stop a running goal: abort the fetch; the server cancels runGoal-side. */
  function cancelGoal(card: GoalCardState): void {
    goalControllers.get(card.id)?.abort();
  }

  return {
    threads,
    currentId,
    currentThread,
    cards,
    planning,
    submitIntent,
    runPlan,
    submitGoal,
    approveGoal,
    cancelGoal,
    discard: dropCard,
    createThread,
    switchThread,
    removeThread,
  };
}
