/**
 * Goal runtime for the WebUI agent mode (issue #97) — approval coordination
 * on top of @tau/agent's runGoal().
 *
 * The stream endpoint mirrors runGoal's lifecycle events verbatim (the
 * goal/round/approval lifecycle events plus the existing step_* shapes) and
 * pauses the loop whenever runGoal asks for approval: the pending promise is
 * parked in this registry keyed by goalId until POST /api/goal/approve
 * resolves it or the TTL expires (resolve false → the loop ends
 * "cancelled"). One pending approval per goal — the loop is strictly
 * sequential.
 */

/** Default wait for a human decision on a paused round (10 minutes). */
export const DEFAULT_APPROVAL_TTL_MS = 10 * 60_000;

/** Env override so tests (and impatient users) can shorten the TTL. */
export function approvalTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env["TAU_WEBUI_APPROVAL_TTL_MS"]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_APPROVAL_TTL_MS;
}

interface PendingApproval {
  round: number;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

/**
 * Per-server approval registry (one instance per createRequestListener —
 * tests get isolation by constructing a fresh server). Every parked promise
 * is settled exactly once: by approve(), by TTL expiry, or by clear().
 */
export class GoalRegistry {
  private readonly pending = new Map<string, PendingApproval>();
  private seq = 0;

  /** Fresh collision-resistant goal id (monotonic suffix + time prefix). */
  createGoalId(): string {
    this.seq += 1;
    return `g-${Date.now().toString(36)}-${this.seq}`;
  }

  /**
   * Park an approval decision for `goalId`. Resolves `false` — and invokes
   * `onTimeout` BEFORE resolving — when the TTL lapses unanswered.
   */
  awaitApproval(goalId: string, round: number, onTimeout: () => void): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(goalId);
        onTimeout();
        resolve(false);
      }, approvalTtlMs());
      timer.unref?.();
      this.pending.set(goalId, { round, resolve, timer });
    });
  }

  /** Resolve a pending approval. False when unknown, expired, or settled. */
  approve(goalId: string, approved: boolean): boolean {
    const entry = this.pending.get(goalId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(goalId);
    entry.resolve(approved);
    return true;
  }

  /** Whether a decision is still pending for this goal. */
  has(goalId: string): boolean {
    return this.pending.has(goalId);
  }

  /** Settle everything as "not approved" (server shutdown / tests). */
  clear(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(false);
    }
    this.pending.clear();
  }
}
