import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, heartbeatRuns, runUsageReceipts, type Db } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { recoverPendingRunUsageReceipts, type UsageReceiptEnvelope } from "./usage-receipts.js";

function envelope(companyId: string, runId: string, sourceId = randomUUID(), sequence = 1): UsageReceiptEnvelope {
  return { schema: "paperclip/accounting-receipt/v1", id: randomUUID(), companyId, runId, sourceId, sequence,
    receivedAt: new Date().toISOString(), adapterType: "process",
    receipt: { complete: false, usageBasis: "per_run", costUsd: 0.01, billingType: "metered_api" } };
}

async function spoolDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), "paperclip-spool-scan-"));
}

afterEach(() => { vi.restoreAllMocks(); });

describe("recoverPendingRunUsageReceipts scan", () => {
  it("does not fail a run start when other runs' checkpoints keep vanishing", async () => {
    const directory = await spoolDirectory(), companyId = randomUUID();
    const read = fs.readFile.bind(fs);
    let churn = 0;
    // Every directory read gains a fresh foreign checkpoint that the background
    // replayer settles and removes before the scan reaches it.
    const readdir = fs.readdir.bind(fs);
    vi.spyOn(fs, "readdir").mockImplementation((async (target: string) => {
      const file = path.join(directory, `${randomUUID()}.json`);
      await fs.writeFile(file, JSON.stringify(envelope(companyId, randomUUID())));
      return readdir(target);
    }) as typeof fs.readdir);
    vi.spyOn(fs, "readFile").mockImplementation((async (file: string, options: unknown) => {
      if (String(file).startsWith(directory)) {
        churn++;
        await fs.rm(file, { force: true });
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      }
      return read(file, options as BufferEncoding);
    }) as typeof fs.readFile);

    await expect(recoverPendingRunUsageReceipts({} as Db, { companyId, runId: randomUUID() }, directory)).resolves.toEqual([]);
    expect(churn).toBeGreaterThan(0);
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("still gives up when the same retry receipt keeps moving", async () => {
    const directory = await spoolDirectory(), companyId = randomUUID();
    await fs.writeFile(path.join(directory, `${randomUUID()}.json`), JSON.stringify(envelope(companyId, randomUUID())));
    const read = fs.readFile.bind(fs);
    // A failing replay rotates each entry to a new retry name while it is read.
    vi.spyOn(fs, "readFile").mockImplementation((async (file: string, options: unknown) => {
      if (String(file).startsWith(directory)) {
        await fs.rename(file, path.join(directory, `retry-${Date.now()}-${randomUUID()}.json`));
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      }
      return read(file, options as BufferEncoding);
    }) as typeof fs.readFile);

    await expect(recoverPendingRunUsageReceipts({} as Db, { companyId, runId: randomUUID() }, directory))
      .rejects.toThrow("Accounting spool changed during recovery");
    await fs.rm(directory, { recursive: true, force: true });
  });
});

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("recoverPendingRunUsageReceipts with PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("usage-receipt-scan-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });

  it("recovers this run's receipt after a failed replay renames it mid-scan", async () => {
    const companyId = randomUUID(), agentId = randomUUID(), runId = randomUUID(), sourceId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Scan fixture", issuePrefix: companyId.slice(0, 8) });
    await db.insert(agents).values({ id: agentId, companyId, name: "Scan agent", adapterType: "process", status: "active" });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running",
      usageJson: { accountingReceiptSourceId: sourceId, accountingReceiptSequence: 0 } });
    const directory = await spoolDirectory();
    const own = envelope(companyId, runId, sourceId);
    await fs.writeFile(path.join(directory, `${own.id}.json`), JSON.stringify(own));
    const read = fs.readFile.bind(fs);
    let rotated = false;
    vi.spyOn(fs, "readFile").mockImplementation((async (file: string, options: unknown) => {
      if (!rotated && String(file).startsWith(directory)) {
        rotated = true;
        await fs.rename(file, path.join(directory, `retry-${Date.now()}-${randomUUID()}.json`));
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      }
      return read(file, options as BufferEncoding);
    }) as typeof fs.readFile);

    const recovered = await recoverPendingRunUsageReceipts(db, { companyId, runId }, directory);
    expect(recovered).toHaveLength(1);
    expect(path.basename(recovered[0])).toMatch(/^retry-/);
    expect(await db.select().from(runUsageReceipts).where(eq(runUsageReceipts.runId, runId))).toHaveLength(1);
    await fs.rm(directory, { recursive: true, force: true });
  });
});
