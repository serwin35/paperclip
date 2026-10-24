Paperclip: GitHub capability_missing; continuing without managed credentials.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, agentWakeupRequests, agents, companies, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issueRecoveryActions, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { quotaResetSpreadMs } from "../provider-quota-retry.js";
import { classifyAdapterFailureForRecovery, recoveryService } from "./service.js";

describe("classifyAdapterFailureForRecovery", () => {
  it("parses a December reset in the current year near year end", () => {
    expect(classifyAdapterFailureForRecovery({
      errorCode: "provider_quota",
      error: "You've hit your weekly limit · resets Dec 30 at 7pm (Europe/Warsaw)",
      resultJson: {},
    }, new Date("2026-12-26T10:00:00.000Z"))).toEqual({
      kind: "provider_quota",
      retryAt: new Date("2026-12-30T18:00:00.000Z"),
      parsedResetTime: true,
    });
  });
});

const postgresSupport = await getEmbeddedPostgresTestSupport();
describe.skipIf(!postgresSupport.supported)("provider quota recovery monitor", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("paperclip-provider-quota-recovery-");
    db = createDb(temporary.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await db?.$client.end(); await temporary?.cleanup(); });
  afterEach(async () => { await db.delete(activityLog); await db.delete(issueRecoveryActions); await db.delete(issues); await db.delete(heartbeatRuns); await db.delete(agentWakeupRequests); await db.delete(agents); await db.delete(companies); });

  it("schedules a provider reset monitor with deterministic spread", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Quota monitor", issuePrefix: "QRM" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Quota agent", adapterType: "claude_local", status: "active", adapterConfig: {}, runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } });
    await db.insert(issues).values({ id: issueId, companyId, title: "Wait for provider reset", status: "in_progress", priority: "medium", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId, scopeKind: "issue", issueId, invocationSource: "automation", status: "failed",
      errorCode: "provider_quota", error: "You've hit your weekly limit · resets Oct 28 at 7pm (Europe/Warsaw)",
      finishedAt: new Date(), resultJson: { executionRecovery: { kind: "bootstrap", providerWorkStarted: false } }, contextSnapshot: { issueId },
    });

    const result = await recoveryService(db, { enqueueWakeup: vi.fn(async () => null) }).reconcileStrandedAssignedIssues();
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(result).toMatchObject({ providerQuotaMonitored: 1, issueIds: [issueId] });
    expect(issue?.monitorNextCheckAt?.toISOString()).toMatch(/^2026-10-28T18:0[1-9]:|^2026-10-28T18:1[0-5]:/);
    expect(issue?.executionPolicy).toMatchObject({ monitor: { nextCheckAt: issue?.monitorNextCheckAt?.toISOString() } });
    expect(run?.resultJson).toMatchObject({ errorFamily: "provider_quota", retryNotBefore: "2026-10-28T18:00:00.000Z" });
  });

  it("persists a spread provider wait retry while retaining the parsed reset timestamp", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const resetAt = new Date("2026-10-28T18:00:00.000Z");
    const expectedRetryAt = new Date(resetAt.getTime() + quotaResetSpreadMs(issueId));
    await db.insert(companies).values({ id: companyId, name: "Quota wait", issuePrefix: "QWT" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Quota agent", adapterType: "claude_local", status: "active", adapterConfig: {}, runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } });
    await db.insert(issues).values({ id: issueId, companyId, title: "Wait for provider reset", status: "in_progress", priority: "medium", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId, scopeKind: "issue", issueId, invocationSource: "automation", status: "failed",
      errorCode: "provider_quota", error: "You've hit your weekly limit", finishedAt: new Date(),
      resultJson: { errorFamily: "provider_quota", retryNotBefore: resetAt.toISOString() }, contextSnapshot: { issueId },
    });
    const service = recoveryService(db, { enqueueWakeup: vi.fn(async () => null) });
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    const [latestRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));

    await service.escalateStrandedAssignedIssue({ issue: issue!, previousStatus: "in_progress", latestRun: latestRun! });

    const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.sourceIssueId, issueId));
    const [scheduled] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, (action?.monitorPolicy as { scheduledRunId: string }).scheduledRunId));
    const [wakeup] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, scheduled!.wakeupRequestId!));
    expect(scheduled?.scheduledRetryAt).toEqual(expectedRetryAt);
    expect(action?.monitorPolicy).toMatchObject({ retryAt: expectedRetryAt.toISOString() });
    expect(action?.timeoutAt).toEqual(expectedRetryAt);
    expect(scheduled?.contextSnapshot).toMatchObject({ providerQuotaRetryNotBefore: resetAt.toISOString() });
    expect(wakeup?.idempotencyKey).toBe(`provider_quota_recovery:${issueId}:${expectedRetryAt.toISOString()}`);
    expect(wakeup?.payload).toMatchObject({ providerQuotaRetryNotBefore: resetAt.toISOString() });
  });
});
