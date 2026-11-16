import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  routineRevisions,
  routineRuns,
  routines,
  routineTriggers,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { routineService } from "../services/routines.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres routine parent lock tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const STUCK_TRANSACTION_TIMEOUT = "10s";

describeEmbeddedPostgres("routine dispatch with a parent task (postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-routine-parent-lock-");
    const admin = createDb(tempDb.connectionString, { maxConnections: 1 });
    await admin.execute(sql.raw(`do $$ begin execute format(
      'alter database %I set idle_in_transaction_session_timeout = %L', current_database(), '${STUCK_TRANSACTION_TIMEOUT}'); end $$`));
    await admin.$client.end();
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    const cleanups = [
      () => db.delete(activityLog),
      () => db.delete(routineRuns),
      () => db.delete(routineTriggers),
      () => db.delete(routineRevisions),
      () => db.delete(routines),
      () => db.delete(heartbeatRuns),
      () => db.delete(issues),
      () => db.delete(agents),
      () => db.delete(companies),
    ];
    for (const cleanup of cleanups) await cleanup().catch(() => undefined);
  });

  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
  });

  async function seedAgentAuthoredRoutineWithParent() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `R${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: randomUUID(),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Routine Owner",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    const [parent] = await db.insert(issues).values({
      companyId,
      title: "Routine parent",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
    }).returning();
    const svc = routineService(db, {
      heartbeat: {
        wakeup: async (wakeupAgentId, wakeupOpts) => {
          const issueId = typeof wakeupOpts.contextSnapshot?.issueId === "string"
            ? wakeupOpts.contextSnapshot.issueId : null;
          if (!issueId) return null;
          const [run] = await db.insert(heartbeatRuns).values({
            companyId,
            agentId: wakeupAgentId,
            invocationSource: wakeupOpts.source ?? "assignment",
            status: "queued",
            contextSnapshot: { ...(wakeupOpts.contextSnapshot ?? {}), issueId },
          }).returning();
          await db.update(issues).set({ executionRunId: run!.id, executionLockedAt: new Date() })
            .where(eq(issues.id, issueId));
          return run;
        },
      },
    });
    const routine = await svc.create(companyId, {
      projectId: null,
      goalId: null,
      parentIssueId: parent!.id,
      title: "Hourly child task",
      description: "Created under a parent task",
      assigneeAgentId: agentId,
      priority: "medium",
      status: "active",
      concurrencyPolicy: "always_enqueue",
      catchUpPolicy: "skip_missed",
      variables: [],
    }, { agentId });
    return { companyId, agentId, parent: parent!, routine, svc };
  }

  async function expectChildTaskCreated(runId: string, parentId: string) {
    const [run] = await db.select().from(routineRuns).where(eq(routineRuns.id, runId));
    expect(run).toMatchObject({ status: "issue_created" });
    const [child] = await db.select().from(issues).where(eq(issues.id, run!.linkedIssueId!));
    expect(child).toMatchObject({ parentId, originKind: "routine_execution", originRunId: runId });
    expect(child!.executionRunId).toBeTruthy();
  }

  it("finishes a scheduled dispatch and creates the child task", async () => {
    const f = await seedAgentAuthoredRoutineWithParent();
    const { trigger } = await f.svc.createTrigger(f.routine.id,
      { kind: "schedule", enabled: true, cronExpression: "0 * * * *", timezone: "UTC" }, { agentId: f.agentId });

    await expect(f.svc.tickScheduledTriggers(trigger.nextRunAt!)).resolves.toEqual({ triggered: 1 });

    const [run] = await db.select().from(routineRuns).where(eq(routineRuns.routineId, f.routine.id));
    expect(run).toMatchObject({ source: "schedule" });
    await expectChildTaskCreated(run!.id, f.parent.id);
  }, 30_000);

  it("finishes a manual run started by an agent and creates the child task", async () => {
    const f = await seedAgentAuthoredRoutineWithParent();

    const run = await f.svc.runRoutine(f.routine.id, { source: "manual" }, { agentId: f.agentId });

    expect(run).toMatchObject({ source: "manual", status: "issue_created" });
    await expectChildTaskCreated(run.id, f.parent.id);
  }, 30_000);
});
