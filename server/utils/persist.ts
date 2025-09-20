import { getPool, withTx } from "./db";

export type StoreShape = {
  googleAccounts: Array<{
    id: string;
    email: string;
    displayName?: string;
    tokens: any;
  }>;
  recallBots: Array<{
    botId: string;
    eventKey: string; // accountId:eventId
    meetingUrl: string;
    platform: string;
    joinAt?: string;
    region?: string;
    status?: string;
    updatedAt?: string;
  }>;
  linkedin?: {
    accessToken: string;
    expiresAt?: string;
    memberId?: string;
  } | null;
  facebook?: {
    accessToken: string;
    expiresAt?: string;
    userId?: string;
  } | null;
};

const cache: StoreShape = { googleAccounts: [], recallBots: [], linkedin: null, facebook: null };

export async function readFromDb(): Promise<StoreShape> {
  const pool = getPool();
  if (!pool) throw new Error("DB not configured");
  const [ga, rb, li, fb] = await Promise.all([
    pool.query("SELECT id, email, display_name, tokens FROM google_accounts ORDER BY email"),
    pool.query("SELECT bot_id, event_key, meeting_url, platform, join_at, region, status, updated_at FROM recall_bots ORDER BY updated_at DESC NULLS LAST"),
    pool.query("SELECT access_token, expires_at, member_id FROM linkedin WHERE id = 1"),
    pool.query("SELECT access_token, expires_at, user_id FROM facebook WHERE id = 1"),
  ]);
  return {
    googleAccounts: ga.rows.map((r) => ({ id: r.id, email: r.email, displayName: r.display_name ?? undefined, tokens: r.tokens })),
    recallBots: rb.rows.map((r) => ({ botId: r.bot_id, eventKey: r.event_key, meetingUrl: r.meeting_url, platform: r.platform, joinAt: r.join_at ? new Date(r.join_at).toISOString() : undefined, region: r.region ?? undefined, status: r.status ?? undefined, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined })),
    linkedin: li.rows[0] ? { accessToken: li.rows[0].access_token, expiresAt: li.rows[0].expires_at ? new Date(li.rows[0].expires_at).toISOString() : undefined, memberId: li.rows[0].member_id ?? undefined } : null,
    facebook: fb.rows[0] ? { accessToken: fb.rows[0].access_token, expiresAt: fb.rows[0].expires_at ? new Date(fb.rows[0].expires_at).toISOString() : undefined, userId: fb.rows[0].user_id ?? undefined } : null,
  };
}

export async function writeToDb(data: StoreShape): Promise<void> {
  await withTx(async (c) => {
    await c.query("DELETE FROM google_accounts");
    for (const a of data.googleAccounts) {
      await c.query(
        "INSERT INTO google_accounts (id, email, display_name, tokens) VALUES ($1,$2,$3,$4)",
        [a.id, a.email, a.displayName ?? null, a.tokens]
      );
    }

    await c.query("DELETE FROM recall_bots");
    for (const b of data.recallBots) {
      await c.query(
        "INSERT INTO recall_bots (bot_id, event_key, meeting_url, platform, join_at, region, status, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [b.botId, b.eventKey, b.meetingUrl, b.platform, b.joinAt ? new Date(b.joinAt) : null, b.region ?? null, b.status ?? null, b.updatedAt ? new Date(b.updatedAt) : null]
      );
    }

    if (data.linkedin?.accessToken) {
      await c.query(
        "INSERT INTO linkedin (id, access_token, expires_at, member_id) VALUES (1,$1,$2,$3) ON CONFLICT (id) DO UPDATE SET access_token = EXCLUDED.access_token, expires_at = EXCLUDED.expires_at, member_id = EXCLUDED.member_id",
        [data.linkedin.accessToken, data.linkedin.expiresAt ? new Date(data.linkedin.expiresAt) : null, data.linkedin.memberId ?? null]
      );
    } else {
      await c.query("DELETE FROM linkedin WHERE id = 1");
    }

    if (data.facebook?.accessToken) {
      await c.query(
        "INSERT INTO facebook (id, access_token, expires_at, user_id) VALUES (1,$1,$2,$3) ON CONFLICT (id) DO UPDATE SET access_token = EXCLUDED.access_token, expires_at = EXCLUDED.expires_at, user_id = EXCLUDED.user_id",
        [data.facebook.accessToken, data.facebook.expiresAt ? new Date(data.facebook.expiresAt) : null, data.facebook.userId ?? null]
      );
    } else {
      await c.query("DELETE FROM facebook WHERE id = 1");
    }
  });
}

export function readStore(): StoreShape {
  return cache;
}

export async function initPersistCache() {
  try {
    const pool = getPool();
    if (!pool) throw new Error("Database not configured");
    const data = await readFromDb();
    cache.googleAccounts = data.googleAccounts;
    cache.recallBots = data.recallBots;
    cache.linkedin = data.linkedin;
    cache.facebook = data.facebook;
  } catch (e) {
    cache.googleAccounts = [];
    cache.recallBots = [];
    cache.linkedin = null;
    cache.facebook = null;
  }
}

export function writeStore(data: StoreShape) {
  cache.googleAccounts = data.googleAccounts;
  cache.recallBots = data.recallBots;
  cache.linkedin = data.linkedin;
  cache.facebook = data.facebook;
  const pool = getPool();
  if (pool) {
    writeToDb(data).catch((e) => console.error("DB write failed:", e));
  }
}
