/**
 * runGoal — Tau's multi-round agent loop: plan -> review -> execute ->
 * reflect -> (next round | done). This is ORCHESTRATION, not a new execution
 * path: every round's plan still goes through @tau/engine's runPlan() (the
 * only execution channel) under a fresh deterministic reviewPlan() — the
 * loop can never execute what the reviewer refuses, and "cancelled"/"denied"
 * rounds always end the goal (a human refusal is never re-asked silently).
 *
 * Continuation policy (per issue #95,公示承诺):
 * - continuation plan verdict "allow"   → run (auto; zero new risk)
 * - continuation plan verdict "review"  → options.awaitApproval decides when
 *   provided (WebUI pause/approve); otherwise runPlan's own interactive
 *   confirmation gates it (CLI / TTY) and refuses headless without --yes
 * - continuation plan verdict "deny"    → goal ends "denied", nothing runs
 * - provider without reflect()          → honest single-round degradation
 *
 * Catalog contract: callers register the full catalog first (ensureCatalog()
 * / CLI ask's registration block) — planIntent renders the live registry.
 */

import type {
  AgentDecision,
  Plan,
  PlanEvent,
  PriorTurn,
  ProviderStreamEvent,
  ProviderUsage,
  ReflectContext,
  RoundFeedback,
  SafetyReview,
} from "@tau/core";
import { loadConfig } from "@tau/core";
import { normalizeUsage, planningContext, resolveProvider, truncateForFeedback } from "@tau/ai";
import { renderSkillCatalog, scanSkills } from "@tau/skills";
import { reviewPlan, runPlan, type RunPlanOptions, type StepOutcome } from "@tau/engine";
import { planIntent, planIntentStream, ProviderUnavailableError } from "./pipeline.js";

/** Loop depth guard: default cap and the hard ceiling (config may lower it). */
export const DEFAULT_MAX_ROUNDS = 3;
export const HARD_MAX_ROUNDS = 5;

/** Terminal states of a whole goal. */
export type GoalStatus = "ok" | "failed" | "cancelled" | "denied" | "max_rounds";

/** Lifecycle events for goal front doors (CLI round headers, WebUI stream). */
export type GoalEvent =
  | { type: "goal_start"; intent: string; maxRounds: number; provider: string }
  | {
      type: "round_plan";
      round: number;
      plan: Plan;
      review: SafetyReview;
      /** "plan" = first round, "reflect" = continuation proposed by the AI. */
      origin: "plan" | "reflect";
    }
  | { type: "round_end"; round: number; status: RoundFeedback["status"]; usage?: ProviderUsage }
  | { type: "approval_required"; round: number; plan: Plan; review: SafetyReview }
  | {
      type: "goal_end";
      status: GoalStatus;
      answer?: string;
      /** Populated when the loop ended abnormally (reflection error etc.). */
      error?: string;
    };

export interface RunGoalOptions {
  /** Explicit provider override; falls back to config's provider. */
  provider?: string;
  /** Round cap (default 3, hard-clamped to 5 — runaway protection). */
  maxRounds?: number;
  /** Per-round runPlan gates: same semantics as `tau ask --yes`. */
  assumeYes: boolean;
  allowMediumAutoApprove: boolean;
  timeoutSec: number;
  /** Skip history writes (tests). */
  skipHistory?: boolean;
  /** Bypass interactive confirm (tests only — reviewed plans). */
  autoApproveAll?: boolean;
  /** Cancellation signal — honored between steps and mid-shell (runPlan). */
  signal?: AbortSignal;
  /**
   * Prior conversation turns (conversation mode, issue #134) — folded into
   * the round-1 planning intent and the reflection context snapshot by the
   * prompt layer, all providers included.
   */
  priorTurns?: PriorTurn[];
  /** Goal lifecycle observer (front doors). */
  onGoalEvent?: (event: GoalEvent) => void;
  /** Per-round PlanEvent mirror (caller brackets rounds via goal events). */
  onPlanEvent?: (event: PlanEvent, round: number) => void;
  /**
   * Per-round provider stream relay (v0.5.0): reasoning/text/usage events
   * from the round's PLANNING turn (round 1 plan + every reflect turn).
   * Absent = the loop uses the buffered plan()/reflect() paths with zero
   * behavior change; present = providers with planStream/reflectStream
   * stream their turns, others fall back to buffered transparently.
   */
  onPlanStream?: (event: ProviderStreamEvent, round: number) => void;
  /**
   * Interactive pause for non-"allow" rounds — INCLUDING the first round
   * when provided (agent mode is never a blanket pre-approval). Resolve
   * true = execute the round; false = goal ends "cancelled". Absent: every
   * round goes straight into runPlan (whose interactive confirm gates it
   * on a TTY and refuses headless without --yes — the historical behavior).
   */
  awaitApproval?: (round: number, plan: Plan, review: SafetyReview) => Promise<boolean>;
}

export interface GoalResult {
  status: GoalStatus;
  /** Executed rounds in order (what actually ran through runPlan). */
  rounds: RoundFeedback[];
  /** Final user-facing answer (present when status === "ok"). */
  answer?: string;
  /** Failure detail when the loop ended abnormally (reflection error etc.). */
  error?: string;
}

/** Fold StepOutcomes into the loop's per-step output strings (truncated). */
function feedbackOutputs(outcomes: StepOutcome[]): string[] {
  return outcomes.map((outcome) => truncateForFeedback(outcome.output));
}

export async function runGoal(intent: string, options: RunGoalOptions): Promise<GoalResult> {
  const emit = options.onGoalEvent ?? (() => {});
  const requested = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxRounds = Math.min(Math.max(1, Math.trunc(requested)), HARD_MAX_ROUNDS);

  const choice = resolveProvider(options.provider);
  const available = await choice.provider.isAvailable();
  if (!available) {
    throw new ProviderUnavailableError(choice.provider.name, choice.provider.unavailableReason?.());
  }
  const reflect = choice.provider.reflect?.bind(choice.provider);
  const canReflect = typeof reflect === "function";
  const reflectStream = choice.provider.reflectStream?.bind(choice.provider);
  emit({
    type: "goal_start",
    intent,
    maxRounds: canReflect ? maxRounds : 1,
    provider: choice.provider.name,
  });

  const rounds: RoundFeedback[] = [];
  const skillCatalog = renderSkillCatalog(scanSkills().skills);
  // Snapshot the planning context ONCE (same construction pipeline.planIntent
  // uses) — reflection reuses the exact catalog the first round planned
  // against, so a mid-goal registry change can never silently widen the
  // continuation surface.
  const ctxBase = planningContext(intent, skillCatalog, options.priorTurns);

  /** Execute one round end-to-end and record its feedback. */
  const executeRound = async (
    round: number,
    plan: Plan,
    usage: ProviderUsage | undefined,
  ): Promise<RoundFeedback["status"]> => {
    const runOptions: RunPlanOptions = {
      provider: choice.provider.name,
      assumeYes: options.assumeYes,
      allowMediumAutoApprove: options.allowMediumAutoApprove,
      timeoutSec: options.timeoutSec,
      skipHistory: options.skipHistory,
      autoApproveAll: options.autoApproveAll,
      signal: options.signal,
      shell: loadConfig().shell,
      onEvent: (event) => options.onPlanEvent?.(event, round),
    };
    const result = await runPlan(intent, plan, runOptions);
    rounds.push({
      round,
      plan,
      status: result.status,
      outputs: feedbackOutputs(result.outcomes),
    });
    emit({ type: "round_end", round, status: result.status, ...(usage ? { usage } : {}) });
    return result.status;
  };

  try {
    // ---- Round 1: the historical front half (planIntent), or its streaming
    // twin when the front door observes provider events. ----
    const planned = options.onPlanStream
      ? await planIntentStream(
          intent,
          { provider: options.provider, priorTurns: options.priorTurns },
          (event) => options.onPlanStream?.(event, 1),
        )
      : await planIntent(intent, { provider: options.provider, priorTurns: options.priorTurns });
    const firstReview = reviewPlan(planned.plan);
    emit({ type: "round_plan", round: 1, plan: planned.plan, review: firstReview, origin: "plan" });
    // Interactive front doors pause on a non-"allow" FIRST round too — agent
    // mode is never a blanket pre-approval: the user sees the plan before
    // anything medium+ runs (headless runPlan still refuses without --yes;
    // CLI keeps its in-runPlan interactive confirm).
    if (firstReview.verdict === "review" && options.awaitApproval) {
      emit({ type: "approval_required", round: 1, plan: planned.plan, review: firstReview });
      const approved = await options.awaitApproval(1, planned.plan, firstReview);
      if (!approved || options.signal?.aborted) {
        emit({ type: "goal_end", status: "cancelled" });
        return { status: "cancelled", rounds };
      }
    }
    let round = 1;
    let lastStatus = await executeRound(1, planned.plan, planned.usage);

    // ---- Rounds 2..n: reflection-driven continuation. ----
    while (
      canReflect &&
      round < maxRounds &&
      lastStatus !== "cancelled" &&
      lastStatus !== "denied" &&
      !options.signal?.aborted
    ) {
      const ctx: ReflectContext = { ...ctxBase, rounds };
      let decision: AgentDecision;
      try {
        decision =
          options.onPlanStream && reflectStream
            ? await reflectStream(ctx, (event) => options.onPlanStream?.(event, round + 1))
            : await reflect(ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: "goal_end", status: "failed", error: `reflection failed: ${message}` });
        return { status: "failed", rounds, error: `reflection failed: ${message}` };
      }
      // The reflect call's own token cost (when reported) is the AI-side
      // price of producing the NEXT round — attach it to that round_end.
      const roundUsage = normalizeUsage((choice.provider as { lastUsage?: unknown }).lastUsage);

      if (decision.done) {
        emit({ type: "goal_end", status: "ok", answer: decision.answer });
        return { status: "ok", rounds, answer: decision.answer };
      }

      // Proposed continuation — re-graded by the deterministic reviewer.
      const review = reviewPlan(decision.plan);
      if (review.verdict === "deny") {
        const error = `next round denied by safety review: ${review.issues
          .map((issue) => issue.message)
          .join("; ")}`;
        emit({ type: "goal_end", status: "denied", error });
        return { status: "denied", rounds, error };
      }

      round += 1;
      emit({ type: "round_plan", round, plan: decision.plan, review, origin: "reflect" });
      if (review.verdict === "review" && options.awaitApproval) {
        emit({ type: "approval_required", round, plan: decision.plan, review });
        const approved = await options.awaitApproval(round, decision.plan, review);
        if (!approved || options.signal?.aborted) {
          emit({ type: "goal_end", status: "cancelled" });
          return { status: "cancelled", rounds };
        }
      }
      lastStatus = await executeRound(round, decision.plan, roundUsage);
    }

    // ---- Terminal folding. ----
    if (options.signal?.aborted || lastStatus === "cancelled") {
      emit({ type: "goal_end", status: "cancelled" });
      return { status: "cancelled", rounds };
    }
    if (lastStatus === "denied") {
      emit({ type: "goal_end", status: "denied" });
      return { status: "denied", rounds };
    }
    if (!canReflect) {
      // Single-round provider: honest degradation — report what ran, state
      // the limitation, never invent a done-answer the provider never gave.
      const note = `provider "${choice.provider.name}" has no reflection support — single-round goal`;
      emit({
        type: "goal_end",
        status: lastStatus === "ok" ? "ok" : "failed",
        ...(lastStatus === "ok" ? { answer: `${planned.plan.explanation}\n(${note})` } : {}),
        ...(lastStatus === "ok" ? {} : { error: note }),
      });
      return {
        status: lastStatus === "ok" ? "ok" : "failed",
        rounds,
        ...(lastStatus === "ok"
          ? { answer: `${planned.plan.explanation}\n(${note})` }
          : { error: note }),
      };
    }
    const capError = `reached the ${maxRounds}-round cap before the provider concluded`;
    emit({ type: "goal_end", status: "max_rounds", error: capError });
    return { status: "max_rounds", rounds, error: capError };
  } catch (error) {
    // Planning/network failures upstream of or between rounds.
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "goal_end", status: "failed", error: message });
    return { status: "failed", rounds, error: message };
  }
}
