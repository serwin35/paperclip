import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, agents, companies, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { recoveryService } from "./service.js";

const postgresSupport = await getEmbeddedPostgresTestSupport();
describe.skipIf(!postgresSupport.supported)("provider quota recovery monitor", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("paperclip-provider-quota-recovery-");
    db = createDb(temporary.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await db?.$client.end(); await temporary?.cleanup(); });
  afterEach(async () => { await db.delete(activityLog); await db.delete(issues); await db.delete(heartbeatRuns); await db.delete(agents); await db.delete(companies); });

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
});
