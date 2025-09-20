import type { RequestHandler } from "express";
import { getPool } from "../utils/db";

function mapRow(r: any) {
  return {
    id: r.id,
    platform: r.platform,
    name: r.name,
    enabled: !!r.enabled,
    template: r.template || "",
    description: r.description || "",
  } as const;
}

export const listAutomations: RequestHandler = async (_req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(500).json({ error: "db not configured" });
    const r = await pool.query("SELECT id, platform, name, enabled, template, description FROM automations ORDER BY platform, name");
    res.json(r.rows.map(mapRow));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'list automations error' });
  }
};

export const replaceAutomations: RequestHandler = async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(500).json({ error: "db not configured" });
    const list = Array.isArray(req.body) ? req.body : [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM automations');
      for (const a of list) {
        await client.query(
          `INSERT INTO automations (id, platform, name, enabled, template, description)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [a.id, a.platform, a.name, !!a.enabled, a.template || '', a.description || null]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
    res.status(204).end();
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'replace automations error' });
  }
};
