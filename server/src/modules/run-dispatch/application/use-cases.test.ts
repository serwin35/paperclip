import { describe, expect, it, vi } from "vitest";
import {
  createCancelStaleQueuedRun,
  createDispatchResolvedInteractionIfCurrent,
  createEvaluateScheduledRetryGate,
  createPromoteDueScheduledRetries,
  createPromoteScheduledRetry,
} from "./use-cases.js";
import type { DueRetryRun, RunDispatchWriter, ScheduledRetryReader } from "./ports.js";

function fakeReader(dueRuns: DueRetryRun[] = []): ScheduledRetryReader & { evaluateCalls: unknown[] } {
  const evaluateCalls: unknown[] = [];
  return {
    evaluateCalls,
    async evaluateScheduledRetryGate(input) {
      evaluateCalls.push(input);
      return { allowed: true };
    },
    async listDueRetries() {
      return dueRuns;
    },
  };
}

function fakeWriter(overrides: Partial<RunDispatchWriter> = {}): RunDispatchWriter & {
  promoteCalls: unknown[];
  cancelCalls: unknown[];
  dispatchCalls: unknown[];
} {
  const promoteCalls: unknown[] = [];
  const cancelCalls: unknown[] = [];
  const dispatchCalls: unknown[] = [];
  return {
    promoteCalls,
    cancelCalls,
    dispatchCalls,
    async promoteOrCancelDueRetry(input) {
      promoteCalls.push(input);
      return { outcome: "promoted", postCommitEffects: [] };
    },
    async cancelStaleQueuedRun(input) {
      cancelCalls.push(input);
      return { outcome: "not_stale" };
    },
    async dispatchResolvedInteractionIfCurrent(input) {
      dispatchCalls.push(input);
      return { dispatched: true, resultPromise: input.dispatch(() => {}) };
    },
    ...overrides,
  };
}

describe("createEvaluateScheduledRetryGate", () => {
  it("maps identifiers and a default clock onto the semantic reader operation", async () => {
    const reader = fakeReader();
    const before = Date.now();
    const result = await createEvaluateScheduledRetryGate({ reader })({
      runId: "run-1",
      companyId: "company-1",
      retryReasonOverride: "max_turns_continuation",
    });

    expect(result).toEqual({ allowed: true });
    expect(reader.evaluateCalls).toHaveLength(1);
    const call = reader.evaluateCalls[0] as { now: Date };
    expect(call).toMatchObject({
      runId: "run-1",
      companyId: "company-1",
      retryReasonOverride: "max_turns_continuation",
    });
    expect(call.now.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("createPromoteScheduledRetry", () => {
  it("passes only semantic identifiers and the clock to the atomic operation", async () => {
    const writer = fakeWriter();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const result = await createPromoteScheduledRetry({ writer })({
      runId: "run-1",
      companyId: "company-1",
      now,
    });

    expect(result).toEqual({ outcome: "promoted", postCommitEffects: [] });
    expect(writer.promoteCalls).toEqual([{ runId: "run-1", companyId: "company-1", now }]);
  });

  it("passes a gate-suppressed outcome through without a persistence row", async () => {
    const writer = fakeWriter({
      promoteOrCancelDueRetry: vi.fn(async () => ({
        outcome: "gate_suppressed" as const,
        reason: "agent paused",
        errorCode: "agent_not_invokable" as const,
      })),
    });
    const result = await createPromoteScheduledRetry({ writer })({
      runId: "run-1",
      companyId: "company-1",
    });
    expect(result).toEqual({
      outcome: "gate_suppressed",
      reason: "agent paused",
      errorCode: "agent_not_invokable",
    });
  });
});

describe("createPromoteDueScheduledRetries", () => {
  it("limits marked retries by provider and counts earlier promotions in the same sweep", async () => {
    const dueRuns = Array.from({ length: 8 }, (_, i) => ({ runId: `quota-${i}`, companyId: "company-1", quotaRecovery: true, adapterType: "claude_local" }));
    const reader = Object.assign(fakeReader(dueRuns), { async listActiveQuotaRetries() { return []; } });
    const deferred: unknown[] = [];
    const writer = fakeWriter({ deferQuotaRecoveryRetry: vi.fn(async (input) => { deferred.push(input); return true; }) });
    const prior = process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
    process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = "3";
    try {
      const result = await createPromoteDueScheduledRetries({ reader, promoteScheduledRetry: createPromoteScheduledRetry({ writer }), deferQuotaRecoveryRetry: writer.deferQuotaRecoveryRetry })({ cutoff: null, now: new Date("2026-10-24T00:00:00.000Z") });
      expect(result.promoted).toBe(3);
      expect(writer.promoteCalls).toHaveLength(3);
      expect(deferred).toHaveLength(5);
    } finally {
      if (prior === undefined) delete process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
      else process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = prior;
    }
  });

  it("reserves only the remaining provider slots when a retry is already running", async () => {
    const dueRuns = Array.from({ length: 5 }, (_, i) => ({ runId: `quota-active-${i}`, companyId: "company-1", quotaRecovery: true, adapterType: "claude_local" }));
    const reader = Object.assign(fakeReader(dueRuns), { async listActiveQuotaRetries() { return [{ adapterType: "claude_local", activeCount: 1 }]; } });
    const deferred = vi.fn(async () => true);
    const writer = fakeWriter({ deferQuotaRecoveryRetry: deferred });
    const prior = process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
    process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = "3";
    try {
      const result = await createPromoteDueScheduledRetries({ reader, promoteScheduledRetry: createPromoteScheduledRetry({ writer }), deferQuotaRecoveryRetry: deferred })({ cutoff: null });
      expect(result.promoted).toBe(2);
      expect(deferred).toHaveBeenCalledTimes(3);
    } finally {
      if (prior === undefined) delete process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
      else process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = prior;
    }
  });

  it("does not apply quota pacing to excluded retries or unpaced adapters", async () => {
    const dueRuns = [
      { runId: "ordinary-inherited-family", companyId: "company-1", quotaRecovery: false, adapterType: "claude_local" },
      { runId: "native-replacement", companyId: "company-1", quotaRecovery: false, adapterType: "claude_local" },
      { runId: "unpaced-quota-source", companyId: "company-1", quotaRecovery: true, adapterType: "custom_adapter" },
    ];
    const reader = Object.assign(fakeReader(dueRuns), { async listActiveQuotaRetries() { return [{ adapterType: "claude_local", activeCount: 3 }]; } });
    const deferred = vi.fn(async () => true);
    const writer = fakeWriter({ deferQuotaRecoveryRetry: deferred });
    const prior = process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
    process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = "3";
    try {
      const result = await createPromoteDueScheduledRetries({ reader, promoteScheduledRetry: createPromoteScheduledRetry({ writer }), deferQuotaRecoveryRetry: deferred })({ cutoff: null });
      expect(result.promoted).toBe(3);
      expect(deferred).not.toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
      else process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = prior;
    }
  });

  it("disables the quota concurrency limit when configured to zero", async () => {
    const dueRuns = Array.from({ length: 5 }, (_, i) => ({ runId: `quota-zero-${i}`, companyId: "company-1", quotaRecovery: true, adapterType: "claude_local" }));
    const reader = Object.assign(fakeReader(dueRuns), { async listActiveQuotaRetries() { return []; } });
    const writer = fakeWriter({ deferQuotaRecoveryRetry: vi.fn(async () => true) });
    const prior = process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
    process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = "0";
    try {
      const result = await createPromoteDueScheduledRetries({ reader, promoteScheduledRetry: createPromoteScheduledRetry({ writer }), deferQuotaRecoveryRetry: writer.deferQuotaRecoveryRetry })({ cutoff: null });
      expect(result.promoted).toBe(5);
      expect(writer.deferQuotaRecoveryRetry).not.toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
      else process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = prior;
    }
  });

  it("keeps newer ordinary retries reachable after deferring older quota retries", async () => {
    let dueRuns = Array.from({ length: 60 }, (_, i) => ({ runId: `quota-backlog-${i}`, companyId: "company-1", quotaRecovery: true, adapterType: "claude_local" }));
    dueRuns.push({ runId: "ordinary-newest", companyId: "company-1", quotaRecovery: false, adapterType: "claude_local" });
    let active = 0;
    const reader = Object.assign(fakeReader(), {
      async listDueRetries(input: { limit: number }) { return dueRuns.slice(0, input.limit); },
      async listActiveQuotaRetries() { return [{ adapterType: "claude_local", activeCount: active }]; },
    });
    const writer = fakeWriter({
      async promoteOrCancelDueRetry(input) {
        active += 1;
        dueRuns = dueRuns.filter((run) => run.runId !== input.runId);
        return { outcome: "promoted", postCommitEffects: [] };
      },
      async deferQuotaRecoveryRetry(input) {
        dueRuns = dueRuns.filter((run) => run.runId !== input.runId);
        return true;
      },
    });
    const prior = process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
    process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = "3";
    try {
      const promote = createPromoteDueScheduledRetries({ reader, promoteScheduledRetry: createPromoteScheduledRetry({ writer }), deferQuotaRecoveryRetry: writer.deferQuotaRecoveryRetry });
      await promote({ cutoff: null });
      const next = await promote({ cutoff: null });
      expect(next.runIds).toContain("ordinary-newest");
      expect(dueRuns.some((run) => run.runId === "ordinary-newest")).toBe(false);
    } finally {
      if (prior === undefined) delete process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
      else process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = prior;
    }
  });

  it("serializes overlapping sweeps so they cannot exceed the per-provider limit", async () => {
    const dueRuns = Array.from({ length: 10 }, (_, i) => ({ runId: `quota-race-${i}`, companyId: "company-1", quotaRecovery: true, adapterType: "claude_local" }));
    let active = 0;
    const reader = Object.assign(fakeReader(dueRuns), { async listActiveQuotaRetries() { return Array.from({ length: active }, () => ({ adapterType: "claude_local" })); } });
    const writer = fakeWriter({
      async promoteOrCancelDueRetry(input) { active += 1; return { outcome: "promoted", postCommitEffects: [] }; },
      async deferQuotaRecoveryRetry() { return true; },
    });
    const prior = process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
    process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = "3";
    try {
      const promote = createPromoteDueScheduledRetries({ reader, promoteScheduledRetry: createPromoteScheduledRetry({ writer }), deferQuotaRecoveryRetry: writer.deferQuotaRecoveryRetry });
      const results = await Promise.all([promote({ cutoff: null }), promote({ cutoff: null })]);
      expect(results.reduce((sum, result) => sum + result.promoted, 0)).toBe(3);
    } finally {
      if (prior === undefined) delete process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER;
      else process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER = prior;
    }
  });

  it("keeps due order and caps a sweep at 50 runs", async () => {
    const dueRuns = Array.from({ length: 75 }, (_, i) => ({
      runId: `run-${i}`,
      companyId: "company-1",
    }));
    const reader = fakeReader(dueRuns);
    const writer = fakeWriter();
    const result = await createPromoteDueScheduledRetries({
      reader,
      promoteScheduledRetry: createPromoteScheduledRetry({ writer }),
    })({ cutoff: null });

    expect(result.promoted).toBe(50);
    expect(result.runIds).toEqual(dueRuns.slice(0, 50).map(({ runId }) => runId));
  });
});

describe("createCancelStaleQueuedRun", () => {
  it("delegates the complete read-decide-cancel operation to the writer", async () => {
    const cancelStaleQueuedRun = vi.fn(async () => ({
      outcome: "cancelled" as const,
      reason: "issue reassigned",
      errorCode: "issue_assignee_changed" as const,
      postCommitEffects: [],
    }));
    const writer = fakeWriter({
      cancelStaleQueuedRun,
    });
    const now = new Date("2026-01-01T00:00:00.000Z");
    const result = await createCancelStaleQueuedRun({ writer })({
      runId: "run-1",
      companyId: "company-1",
      expectedStatus: "queued",
      now,
    });

    expect(result.outcome).toBe("cancelled");
    expect(cancelStaleQueuedRun).toHaveBeenCalledWith({
      runId: "run-1",
      companyId: "company-1",
      expectedStatus: "queued",
      now,
    });
  });
});

describe("createDispatchResolvedInteractionIfCurrent", () => {
  it("delegates the lock, validation, cancellation, and dispatch boundary", async () => {
    const writer = fakeWriter();
    const dispatch = vi.fn(async () => "started");
    const result = await createDispatchResolvedInteractionIfCurrent({ writer })({
      runId: "run-1",
      companyId: "company-1",
      expectedStatus: "running",
      reservationId: "reservation-1",
      enforceContinuationOwnership: false,
      dispatch,
    });

    expect(result.dispatched).toBe(true);
    expect(writer.dispatchCalls).toHaveLength(1);
    expect(writer.dispatchCalls[0]).toMatchObject({ enforceContinuationOwnership: false });
  });
});
