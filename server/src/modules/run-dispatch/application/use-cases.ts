import type { RunDispatchWriter, ScheduledRetryReader } from "./ports.js";
import { pacedProviderForAdapterType } from "../../../services/quota-pacing.js";
import type { PostCommitEffect, PromoteScheduledRetryOutcome } from "./types.js";

export function createEvaluateScheduledRetryGate(deps: { reader: ScheduledRetryReader }) {
  return (input: {
    runId: string;
    companyId: string;
    retryReasonOverride: string;
    now?: Date;
  }) => deps.reader.evaluateScheduledRetryGate({ ...input, now: input.now ?? new Date() });
}

export function createPromoteScheduledRetry(deps: { writer: RunDispatchWriter }) {
  return (input: {
    runId: string;
    companyId: string;
    now?: Date;
  }): Promise<PromoteScheduledRetryOutcome> =>
    deps.writer.promoteOrCancelDueRetry({
      runId: input.runId,
      companyId: input.companyId,
      now: input.now ?? new Date(),
    });
}

const MAX_DUE_RETRIES_PER_SWEEP = 50;
let promotionQueue: Promise<void> = Promise.resolve();

function quotaRecoveryLimit() {
  const configured = Number.parseInt(process.env.PAPERCLIP_QUOTA_RECOVERY_MAX_CONCURRENT_PER_PROVIDER ?? "3", 10);
  return Number.isFinite(configured) ? Math.max(0, configured) : 3;
}

export function createPromoteDueScheduledRetries(deps: {
  reader: ScheduledRetryReader;
  promoteScheduledRetry: ReturnType<typeof createPromoteScheduledRetry>;
  deferQuotaRecoveryRetry?: RunDispatchWriter["deferQuotaRecoveryRetry"];
}) {
  return async function promoteDueScheduledRetries(input: { now?: Date; cutoff: Date | null }) {
    let release!: () => void;
    const previous = promotionQueue;
    promotionQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const now = input.now ?? new Date();
      const dueRuns = (
        await deps.reader.listDueRetries({ now, cutoff: input.cutoff, limit: MAX_DUE_RETRIES_PER_SWEEP })
      ).slice(0, MAX_DUE_RETRIES_PER_SWEEP);
      const runIds: string[] = [];
      const postCommitEffects: PostCommitEffect[] = [];
      const limit = quotaRecoveryLimit();
      const activeByProvider = new Map<string, number>();
      if (limit > 0 && dueRuns.some((run) => run.quotaRecovery) && deps.reader.listActiveQuotaRetries) {
        for (const active of await deps.reader.listActiveQuotaRetries()) {
          const provider = pacedProviderForAdapterType(active.adapterType);
          if (provider) activeByProvider.set(provider, (activeByProvider.get(provider) ?? 0) + (active.activeCount ?? 1));
        }
      }

      for (const dueRun of dueRuns) {
        const provider = dueRun.quotaRecovery && dueRun.adapterType
          ? pacedProviderForAdapterType(dueRun.adapterType)
          : null;
        if (limit > 0 && provider && (activeByProvider.get(provider) ?? 0) >= limit) {
          await deps.deferQuotaRecoveryRetry?.({ runId: dueRun.runId, provider, limit, now });
          continue;
        }
        const result = await deps.promoteScheduledRetry({ ...dueRun, now });
        if (result.outcome !== "promoted") continue;
        runIds.push(dueRun.runId);
        if (limit > 0 && provider) activeByProvider.set(provider, (activeByProvider.get(provider) ?? 0) + 1);
        postCommitEffects.push(...result.postCommitEffects);
      }
      return { promoted: runIds.length, runIds, postCommitEffects };
    } finally {
      release();
    }
  };
}

export function createCancelStaleQueuedRun(deps: { writer: RunDispatchWriter }) {
  return (input: {
    runId: string;
    companyId: string;
    expectedStatus: "queued" | "running";
    now?: Date;
  }) => deps.writer.cancelStaleQueuedRun({ ...input, now: input.now ?? new Date() });
}

export function createDispatchResolvedInteractionIfCurrent(deps: { writer: RunDispatchWriter }) {
  return <T>(input: {
    runId: string;
    companyId: string;
    expectedStatus: "queued" | "running";
    reservationId: string;
    recoveryLeaseOwner?: string;
    enforceContinuationOwnership?: boolean;
    dispatch: (markDispatchStarted: () => void) => Promise<T>;
    now?: Date;
  }) => deps.writer.dispatchResolvedInteractionIfCurrent({
    ...input,
    now: input.now ?? new Date(),
  });
}
