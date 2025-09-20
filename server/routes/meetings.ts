import type { RequestHandler } from "express";
import { getPool } from "../utils/db";

function mapRow(r: any) {
  return {
    id: r.id,
    eventId: r.event_id,
    accountId: r.account_id,
    platform: r.platform,
    title: r.title,
    start: new Date(r.start).toISOString(),
    attendees: Array.isArray(r.attendees) ? r.attendees : (typeof r.attendees === 'object' && r.attendees) ? r.attendees : [],
    transcript: r.transcript || "",
    media: {
      botId: r.bot_id || undefined,
      hasRecording: !!r.has_recording,
      hasTranscript: !!r.has_transcript,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    },
  };
}

export const listPastMeetings: RequestHandler = async (req, res) => {
  try {
    const pool = getPool();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    if (!pool) return res.status(500).json({ error: "db not configured" });
    const result = await pool.query("SELECT * FROM past_meetings ORDER BY start DESC LIMIT $1 OFFSET $2", [limit, offset]);
    res.json(result.rows.map(mapRow));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "list meetings error" });
  }
};

export const indexPastMeetings: RequestHandler = async (_req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(500).json({ error: "db not configured" });
    const result = await pool.query("SELECT id, bot_id, has_transcript, has_recording FROM past_meetings");
    res.json(result.rows.map((r) => ({ id: r.id, botId: r.bot_id, hasTranscript: !!r.has_transcript, hasRecording: !!r.has_recording })));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "index meetings error" });
  }
};

export const upsertPastMeeting: RequestHandler = async (req, res) => {
  try {
    const pool = getPool();
    const m = req.body as any;
    if (!pool) return res.status(500).json({ error: "db not configured" });
    if (!m?.id || !m?.title || !m?.start || !m?.platform) return res.status(400).json({ error: "missing fields" });
    const attendees = Array.isArray(m.attendees) ? m.attendees : [];
    await pool.query(
      `INSERT INTO past_meetings (id, event_id, account_id, platform, title, start, attendees, transcript, bot_id, has_recording, has_transcript, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,now())
       ON CONFLICT (id) DO UPDATE SET
         event_id = EXCLUDED.event_id,
         account_id = EXCLUDED.account_id,
         platform = EXCLUDED.platform,
         title = EXCLUDED.title,
         start = EXCLUDED.start,
         attendees = EXCLUDED.attendees,
         transcript = EXCLUDED.transcript,
         bot_id = EXCLUDED.bot_id,
         has_recording = EXCLUDED.has_recording,
         has_transcript = EXCLUDED.has_transcript,
         updated_at = now()
      `,
      [
        m.id,
        m.eventId || m.id,
        m.accountId || null,
        m.platform,
        m.title,
        new Date(m.start),
        JSON.stringify(attendees),
        m.transcript || "",
        m.media?.botId || null,
        !!m.media?.hasRecording,
        !!m.media?.hasTranscript,
      ]
    );
    res.status(204).end();
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "upsert meeting error" });
  }
};
