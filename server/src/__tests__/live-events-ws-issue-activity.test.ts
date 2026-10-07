import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres live activity tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// Activity toasts name the task ("Agent updated COD-12") and say what changed.
// Stripping activity events to {action, entityType, entityId} left the browser
// with "Task 1df252ds" whenever the task was not already in its query cache.
// A viewer who may read the task still gets only the fields a toast needs.
describeEmbeddedPostgres("live activity events on a readable task", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = "enforce";
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-live-issue-activity-");
    db = createDb(tempDb.connectionString);
  }, 120_000);
  afterAll(async () => { await tempDb?.cleanup(); });

  async function openSocket(companyId: string, userId: string) {
    const { setupLiveEventsWebSocketServer } = await import("../realtime/live-events-ws.js");
    const server = createServer();
    const wss = setupLiveEventsWebSocketServer(server, db, {
      deploymentMode: "authenticated",
      resolveCloudActor: async () => ({ userId, companyIds: [companyId] }),
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}/api/companies/${companyId}/events/ws`);
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    socket.on("message", data => messages.push(JSON.parse(data.toString())));
    await once(socket, "open");
    const close = async () => {
      socket.terminate();
      await new Promise<void>(resolve => (wss as any).close(resolve));
      await new Promise<void>(resolve => server.close(() => resolve()));
    };
    return { messages, close };
  }

  it("keeps the task identifier, title, actor and status change, and nothing else", async () => {
    const prefix = `T${randomUUID().slice(0, 5).toUpperCase()}`;
    const [company] = await db.insert(companies).values({ name: randomUUID(), issuePrefix: prefix }).returning();
    const owner = randomUUID(), outsider = randomUUID();
    await db.insert(authUsers).values([owner, outsider].map(id => ({ id, name: id, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([owner, outsider].map(principalId => ({ companyId: company.id, principalType: "user", principalId, status: "active", membershipRole: "operator" })));
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Coder", role: "engineer", adapterType: "process", adapterConfig: {}, runtimeConfig: {}, permissions: {} }).returning();
    const [task] = await db.insert(issues).values({
      companyId: company.id, title: "Ship the release", visibility: "private", responsibleUserId: owner,
      issueNumber: 12, identifier: `${prefix}-12`,
    }).returning();
    const { publishLiveEvent } = await import("../services/live-events.js");

    const ownerSocket = await openSocket(company.id, owner);
    const outsiderSocket = await openSocket(company.id, outsider);
    try {
      publishLiveEvent({ companyId: company.id, type: "activity.logged", payload: {
        issueId: task.id, actorType: "agent", actorId: agent.id, action: "issue.updated",
        entityType: "issue", entityId: task.id, agentId: agent.id, runId: null, responsibleUserId: owner,
        details: {
          identifier: "SPOOFED-1", status: "done", source: "api",
          _previous: { status: "in_progress", description: "PREVIOUS_DESCRIPTION_CANARY" },
          description: "DESCRIPTION_CANARY", blockedByIssueIds: [randomUUID()], bodySnippet: "SNIPPET_CANARY",
        },
      } });
      publishLiveEvent({ companyId: company.id, type: "activity.logged", payload: { action: "queue_drained", entityType: "company", entityId: company.id } });

      await expect.poll(() => ownerSocket.messages.some(m => m.payload.action === "queue_drained")).toBe(true);
      const update = ownerSocket.messages.find(m => m.payload.action === "issue.updated");
      expect(update?.payload).toEqual({
        action: "issue.updated", entityType: "issue", entityId: task.id, issueId: task.id,
        actorType: "agent", actorId: agent.id,
        details: {
          identifier: `${prefix}-12`, issueTitle: "Ship the release",
          status: "done", source: "api", _previous: { status: "in_progress" },
        },
      });

      await expect.poll(() => outsiderSocket.messages.some(m => m.payload.action === "queue_drained")).toBe(true);
      expect(outsiderSocket.messages.map(m => m.payload.action)).not.toContain("issue.updated");
      expect(JSON.stringify(outsiderSocket.messages)).not.toContain("Ship the release");
    } finally {
      await ownerSocket.close();
      await outsiderSocket.close();
    }
  });

  it("strips activity on entities other than a task to the bare invalidation", async () => {
    const [company] = await db.insert(companies).values({ name: randomUUID(), issuePrefix: `T${randomUUID().slice(0, 5).toUpperCase()}` }).returning();
    const owner = randomUUID();
    await db.insert(authUsers).values({ id: owner, name: owner, email: `${owner}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: owner, status: "active", membershipRole: "operator" });
    const { publishLiveEvent } = await import("../services/live-events.js");

    const ownerSocket = await openSocket(company.id, owner);
    try {
      publishLiveEvent({ companyId: company.id, type: "activity.logged", payload: {
        actorType: "user", actorId: owner, action: "company.updated", entityType: "company", entityId: company.id,
        details: { name: "COMPANY_DETAIL_CANARY" },
      } });
      await expect.poll(() => ownerSocket.messages.some(m => m.payload.action === "company.updated")).toBe(true);
      expect(ownerSocket.messages.find(m => m.payload.action === "company.updated")?.payload).toEqual({
        action: "company.updated", entityType: "company", entityId: company.id,
      });
    } finally {
      await ownerSocket.close();
    }
  });
});
