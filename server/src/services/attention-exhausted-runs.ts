import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { agents, heartbeatRunEvents, heartbeatRuns, type Db } from "@paperclipai/db";

export function listAttentionExhaustedRuns(db: Db, companyId: string) {
  // Recovery can revisit an exhausted run. Deduplicate its historical events
  // before joining run data so duplicate events never multiply the wire payload.
  const latestExhaustion = db
    .selectDistinctOn([heartbeatRunEvents.runId], {
      runId: heartbeatRunEvents.runId,
      eventId: heartbeatRunEvents.id,
      message: heartbeatRunEvents.message,
    })
    .from(heartbeatRunEvents)
    // Keep both receipt filters as SQL literals. They must match the partial
    // index heartbeat_run_events_retry_exhausted_idx; a bound parameter would
    // stop a generic prepared plan from using it.
    .where(and(
      eq(heartbeatRunEvents.companyId, companyId),
      sql`${heartbeatRunEvents.eventType} = 'lifecycle'`,
      sql`${heartbeatRunEvents.message} like 'Bounded retry exhausted%'`,
    ))
    .orderBy(asc(heartbeatRunEvents.runId), desc(heartbeatRunEvents.id))
    .as("latest_exhaustion");

  return db
    .select({
      id: heartbeatRuns.id,
      companyId: heartbeatRuns.companyId,
      agentId: heartbeatRuns.agentId,
      agentName: agents.name,
      status: heartbeatRuns.status,
      error: heartbeatRuns.error,
      errorCode: heartbeatRuns.errorCode,
      // Preserve JSON types and issueId/taskId fallback semantics without
      // transferring prompts, transcripts, or the rest of the run context.
      // Prefer the issue_id column: reading the snapshot detoasts the whole
      // run context (tens of kB per run), which cost ~1.9 s per attention
      // request across a few thousand exhausted runs. The snapshot is still
      // read when the column is null, e.g. after the issue was deleted.
      contextSnapshot: sql<Record<string, unknown>>`case
        when ${heartbeatRuns.issueId} is not null then jsonb_build_object('issueId', ${heartbeatRuns.issueId}, 'taskId', null)
        else jsonb_build_object(
          'issueId', ${heartbeatRuns.contextSnapshot} -> 'issueId',
          'taskId', ${heartbeatRuns.contextSnapshot} -> 'taskId'
        )
      end`,
      createdAt: heartbeatRuns.createdAt,
      updatedAt: heartbeatRuns.updatedAt,
      finishedAt: heartbeatRuns.finishedAt,
      exhaustionMessage: latestExhaustion.message,
    })
    .from(heartbeatRuns)
    .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
    .innerJoin(latestExhaustion, eq(latestExhaustion.runId, heartbeatRuns.id))
    .where(and(
      eq(heartbeatRuns.companyId, companyId),
      eq(agents.companyId, companyId),
      notInArray(agents.status, ["terminated"]),
      inArray(heartbeatRuns.status, ["failed", "timed_out"]),
    ))
    .orderBy(desc(heartbeatRuns.createdAt), desc(latestExhaustion.eventId));
}
