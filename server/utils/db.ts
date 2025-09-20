import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!connectionString) {
  console.warn("DATABASE_URL not set. Server will fallback to file store for persistence where used.");
}

let pool: Pool | null = null;
export function getPool() {
  if (!connectionString) return null;
  if (!pool) {
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

export async function withTx<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const p = getPool();
  if (!p) throw new Error("Database not configured");
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}
