import { getPool } from "./db";

export async function ensureSchema() {
  const pool = getPool();
  if (!pool) throw new Error("Database not configured (DATABASE_URL)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_accounts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      tokens JSONB NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recall_bots (
      bot_id TEXT PRIMARY KEY,
      event_key TEXT NOT NULL,
      meeting_url TEXT NOT NULL,
      platform TEXT,
      join_at TIMESTAMPTZ,
      region TEXT,
      status TEXT,
      updated_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS linkedin (
      id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ,
      member_id TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS facebook (
      id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ,
      user_id TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS past_meetings (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      account_id TEXT,
      platform TEXT NOT NULL,
      title TEXT NOT NULL,
      start TIMESTAMPTZ NOT NULL,
      attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
      transcript TEXT,
      bot_id TEXT,
      has_recording BOOLEAN DEFAULT FALSE,
      has_transcript BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_past_meetings_start ON past_meetings (start DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      minutes_before_join INTEGER,
      window_days INTEGER,
      poll_seconds INTEGER,
      recall_region TEXT,
      linked_in_target TEXT,
      linked_in_org_urn TEXT,
      linked_in_org_name TEXT,
      facebook_target TEXT,
      facebook_page_id TEXT,
      facebook_page_name TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      name TEXT,
      enabled BOOLEAN DEFAULT TRUE,
      template TEXT,
      description TEXT
    );
  `);
}
