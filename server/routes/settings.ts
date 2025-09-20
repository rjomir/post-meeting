import type { RequestHandler } from "express";
import { getPool } from "../utils/db";

export const getSettings: RequestHandler = async (_req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(500).json({ error: "db not configured" });
    const r = await pool.query(`
      SELECT id, minutes_before_join, window_days, poll_seconds, recall_region,
             linked_in_target, linked_in_org_urn, linked_in_org_name,
             facebook_target, facebook_page_id, facebook_page_name
      FROM settings WHERE id = 1`);
    if (!r.rows[0]) {
      return res.json({ minutesBeforeJoin: 5, windowDays: 45, pollSeconds: 60, recallRegion: "us-east-1" });
    }
    const s = r.rows[0];
    res.json({
      minutesBeforeJoin: s.minutes_before_join ?? 5,
      windowDays: s.window_days ?? 45,
      pollSeconds: s.poll_seconds ?? 60,
      recallRegion: s.recall_region ?? "us-east-1",
      linkedInTarget: s.linked_in_target ?? 'profile',
      linkedInOrgUrn: s.linked_in_org_urn ?? undefined,
      linkedInOrgName: s.linked_in_org_name ?? undefined,
      facebookTarget: s.facebook_target ?? 'page',
      facebookPageId: s.facebook_page_id ?? undefined,
      facebookPageName: s.facebook_page_name ?? undefined,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'get settings error' });
  }
};

export const saveSettings: RequestHandler = async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(500).json({ error: "db not configured" });
    const s = req.body || {};
    await pool.query(`
      INSERT INTO settings (
        id, minutes_before_join, window_days, poll_seconds, recall_region,
        linked_in_target, linked_in_org_urn, linked_in_org_name,
        facebook_target, facebook_page_id, facebook_page_name
      ) VALUES (
        1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) ON CONFLICT (id) DO UPDATE SET
        minutes_before_join = EXCLUDED.minutes_before_join,
        window_days = EXCLUDED.window_days,
        poll_seconds = EXCLUDED.poll_seconds,
        recall_region = EXCLUDED.recall_region,
        linked_in_target = EXCLUDED.linked_in_target,
        linked_in_org_urn = EXCLUDED.linked_in_org_urn,
        linked_in_org_name = EXCLUDED.linked_in_org_name,
        facebook_target = EXCLUDED.facebook_target,
        facebook_page_id = EXCLUDED.facebook_page_id,
        facebook_page_name = EXCLUDED.facebook_page_name
    `, [
      s.minutesBeforeJoin ?? 5,
      s.windowDays ?? 45,
      s.pollSeconds ?? 60,
      s.recallRegion ?? 'us-east-1',
      s.linkedInTarget ?? 'profile',
      s.linkedInOrgUrn ?? null,
      s.linkedInOrgName ?? null,
      s.facebookTarget ?? 'page',
      s.facebookPageId ?? null,
      s.facebookPageName ?? null,
    ]);
    res.status(204).end();
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'save settings error' });
  }
};
