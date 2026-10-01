import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/index.ts";
import { heartbeatService } from "../services/heartbeat.ts";
import { instanceSettingsService } from "../services/instance-settings.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const POOL_DEADLOCK_TEST_ADAPTER = "wake_pool_deadlock_test";

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres wake pool tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// An issue wake opens a transaction that locks the issue row. With isolated
// workspaces on, deciding whether the prior session still has a workspace read
// the task session through the pool instead of the transaction. Each wake then
// held one connection and waited for another, so as many concurrent wakes as
// pool connections hung the whole server. A pool of one makes a single wake
// reproduce it deterministically.
describeEmbeddedPostgres("issue wake with a saturated connection pool", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-wake-pool-");
    db = createDb(tempDb.connectionString, { maxConnections: 1 });
    heartbeat = heartbeatService(db);
    registerServerAdapter({
      type: POOL_DEADLOCK_TEST_ADAPTER,
      execute: async () => ({ exitCode: 0, signal: null, timedOut: false, resultJson: {} }),
      testEnvironment: async () => ({
        adapterType: POOL_DEADLOCK_TEST_ADAPTER,
        status: "pass",
        checks: [],
        testedAt: new Date().toISOString(),
      }),
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });
  }, 30_000);

  afterAll(async () => {
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    unregisterServerAdapter(POOL_DEADLOCK_TEST_ADAPTER);
    await tempDb?.cleanup();
  });

  it("wakes an agent on an issue without needing a second pool connection", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Coder",
      role: "engineer",
      status: "idle",
      adapterType: POOL_DEADLOCK_TEST_ADAPTER,
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Pool deadlock issue",
      status: "todo",
      priority: "medium",
      responsibleUserId: "responsible-user",
      assigneeAgentId: agentId,
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    const wake = heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "pool_deadlock_regression",
      payload: { issueId },
      contextSnapshot: { issueId, taskId: issueId },
    });
    const outcome = await Promise.race([
      wake.then(() => "woken" as const),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 10_000)),
    ]);

    expect(outcome).toBe("woken");
  }, 30_000);
});
