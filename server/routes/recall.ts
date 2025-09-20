import { readStore, writeStore } from "../utils/persist";
import type { RequestHandler } from "express";

const RECALL_REGION = process.env.RECALL_REGION || "us-east-1";
const RECALL_BASE = process.env.RECALL_API_BASE || `https://${RECALL_REGION}.recall.ai/api/v1`;

async function recallFetch(path: string, init?: RequestInit) {
  // Determine region from URL if provided, else default
  let regionForAuth = RECALL_REGION;
  const urlStr = path.startsWith("http") ? path : `${RECALL_BASE}${path}`;
  try {
    const host = new URL(urlStr).hostname;
    const m = host.match(/^([a-z0-9-]+)\.recall\.ai$/);
    if (m) regionForAuth = m[1];
  } catch {}

  const envKeyName = `RECALL_API_KEY_${regionForAuth.replace(/-/g, "_").toUpperCase()}`;
  const key = (process.env as any)[envKeyName] || process.env.RECALL_API_KEY;
  if (!key) throw new Error("Missing RECALL_API_KEY env for selected region");

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Token ${key}`);
  headers.set("Accept", "application/json");
  if (!headers.has("Content-Type") && (init?.method || "GET").toUpperCase() !== "GET") {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(urlStr, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Recall API ${res.status}: ${text}`);
  }
  return res.json();
}

const schedulingLocks = new Set<string>();

export const scheduleBot: RequestHandler = async (req, res) => {
  try {
    const { eventKey, meetingUrl, platform, joinAt } = req.body as {
      eventKey: string;
      meetingUrl: string;
      platform?: string;
      joinAt?: string;
    };
    if (!eventKey || !meetingUrl) return res.status(400).json({ error: "eventKey and meetingUrl required" });

    const region = (req.body as any)?.region || RECALL_REGION;
    const base = `https://${region}.recall.ai/api/v1`;

    // Fast-path: existing mapping
    let store = readStore();
    let existing = store.recallBots.find((b) => b.eventKey === eventKey);
    if (existing?.botId) {
      return res.json({ botId: existing.botId, created: false });
    }

    // Prevent duplicate concurrent creations per eventKey
    if (schedulingLocks.has(eventKey)) {
      // Another request in-flight; return existing if any, else 202
      existing = readStore().recallBots.find((b) => b.eventKey === eventKey);
      if (existing?.botId) return res.json({ botId: existing.botId, created: false });
      return res.status(202).json({ status: "scheduling" });
    }

    schedulingLocks.add(eventKey);
    try {
      // Re-check after acquiring lock
      store = readStore();
      existing = store.recallBots.find((b) => b.eventKey === eventKey);
      if (existing?.botId) {
        return res.json({ botId: existing.botId, created: false });
      }

      // Create a new bot
      const created: any = await recallFetch(`${base}/bot`, {
        method: "POST",
        body: JSON.stringify({
          meeting_url: meetingUrl,
          join_at: joinAt,
          recording_config: {
            transcript: {
              provider: {
                recallai_streaming: {},
              },
            },
          },
        }),
      });

      const botId = created?.id || created?.bot_id;
      if (!botId) return res.status(502).json({ error: "Failed to create Recall bot" });

      // Persist mapping
      store = readStore();
      existing = store.recallBots.find((b) => b.eventKey === eventKey);
      if (existing) {
        existing.botId = botId;
        existing.meetingUrl = meetingUrl;
        existing.platform = platform || existing.platform;
        existing.joinAt = joinAt;
        existing.region = region;
        existing.status = "created";
        existing.updatedAt = new Date().toISOString();
      } else {
        store.recallBots.push({ botId, eventKey, meetingUrl, platform: platform || "unknown", joinAt, region, status: "created", updatedAt: new Date().toISOString() });
      }
      writeStore(store);

      res.json({ botId, created: true });
    } finally {
      schedulingLocks.delete(eventKey);
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const pollBot: RequestHandler = async (req, res) => {
  try {
    const { botId } = req.query as { botId: string };
    if (!botId) return res.status(400).json({ error: "botId required" });

    const store = readStore();
    const b = store.recallBots.find((x) => x.botId === botId);
    const region = b?.region || RECALL_REGION;
    const base = `https://${region}.recall.ai/api/v1`;

    let info: any = null;
    try {
      info = await recallFetch(`${base}/bot/${botId}`, { method: "GET" });
    } catch (e) {
      // fallthrough
    }
    const recordings = Array.isArray(info?.recordings) ? info.recordings : [];
    const statusCodes = Array.isArray(info?.status_changes) ? info.status_changes.map((s: any) => s?.code) : [];
    const hasRecording = recordings.some((r: any) =>
      r?.status?.code === "done" ||
      r?.media_shortcuts?.video_mixed?.status?.code === "done" ||
      !!r?.media_shortcuts?.video_mixed?.data?.download_url
    ) || statusCodes.includes("recording_done") || statusCodes.includes("done");

    const hasTranscript = recordings.some((r: any) =>
      !!r?.media_shortcuts?.transcript?.data?.download_url ||
      r?.media_shortcuts?.transcript?.status?.code === "done" ||
      (Array.isArray(r?.transcripts) && r.transcripts.length > 0)
    ) || Boolean(info?.transcript_available || (Array.isArray(info?.transcripts) && info.transcripts.length > 0));

    if (b) {
      b.status = hasRecording || hasTranscript ? "media_available" : "running";
      b.updatedAt = new Date().toISOString();
      writeStore(store);
    }
    res.json({ botId, hasRecording, hasTranscript, raw: info });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const listTrackedBots: RequestHandler = (_req, res) => {
  const store = readStore();
  res.json(store.recallBots);
};

export const finalizeBot: RequestHandler = async (req, res) => {
  try {
    const { botId } = (req.query as any) as { botId?: string };
    if (!botId) return res.status(400).json({ error: "botId required" });
    const store = readStore();
    const before = store.recallBots.length;
    store.recallBots = store.recallBots.filter((b) => b.botId !== botId);
    writeStore(store);
    return res.json({ removed: before - store.recallBots.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "finalize error" });
  }
};

function resolveRegionFor(urlStr: string) {
  try {
    const host = new URL(urlStr).hostname;
    const m = host.match(/^([a-z0-9-]+)\.recall\.ai$/);
    if (m) return m[1];
  } catch {}
  return RECALL_REGION;
}

async function fetchWithAuthText(urlStr: string, regionHint?: string) {
  const region = regionHint || resolveRegionFor(urlStr);
  const envKeyName = `RECALL_API_KEY_${region.replace(/-/g, "_").toUpperCase()}`;
  const key = (process.env as any)[envKeyName] || process.env.RECALL_API_KEY;
  if (!key) throw new Error("Missing RECALL_API_KEY env for selected region");
  const host = (() => { try { return new URL(urlStr).hostname; } catch { return ""; } })();
  const looksPresigned = /amazonaws\.com/i.test(host) || /\/download\//i.test(urlStr);
  let res: Response | null = null;
  if (looksPresigned) {
    res = await fetch(urlStr);
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      res = await fetch(urlStr, { headers: { Authorization: `Token ${key}` } });
    }
  } else {
    res = await fetch(urlStr, { headers: { Authorization: `Token ${key}` } });
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      res = await fetch(urlStr);
    }
  }
  if (!res.ok) throw new Error(`Recall download ${res.status}`);
  return res.text();
}

function extractTranscriptFromJsonString(s: string): string {
  try {
    const obj = JSON.parse(s);
    if (obj == null) return "";

    // Root array of segments/turns with word tokens
    if (Array.isArray(obj)) {
      const parts: string[] = [];
      for (const item of obj) {
        if (Array.isArray(item?.words)) {
          const words = item.words.map((w: any) => w?.text).filter((t: any) => typeof t === "string");
          if (words.length) parts.push(words.join(" "));
        } else if (typeof item?.text === "string") {
          parts.push(item.text);
        }
      }
      if (parts.length) return parts.join(" ");
    }

    if (typeof (obj as any).text === "string") return (obj as any).text as string;
    if (Array.isArray((obj as any).segments)) {
      const segs = (obj as any).segments.map((seg: any) => seg?.text).filter((t: any) => typeof t === "string");
      if (segs.length) return segs.join(" ");
    }
    if (Array.isArray((obj as any).results)) {
      const res = (obj as any).results
        .map((r: any) => r?.alternatives?.[0]?.transcript || r?.text)
        .filter((t: any) => typeof t === "string");
      if (res.length) return res.join(" ");
    }
    if (Array.isArray((obj as any).utterances)) {
      const uts = (obj as any).utterances.map((u: any) => u?.text).filter((t: any) => typeof t === "string");
      if (uts.length) return uts.join(" ");
    }
    return "";
  } catch {
    return "";
  }
}

export const getTranscript: RequestHandler = async (req, res) => {
  try {
    const { botId } = req.query as { botId?: string };
    if (!botId) return res.status(400).json({ error: "botId required" });

    const store = readStore();
    const b = store.recallBots.find((x) => x.botId === botId);
    const region = b?.region || RECALL_REGION;
    const base = `https://${region}.recall.ai/api/v1`;

    let info: any = null;
    const regionsToTry = Array.from(new Set([region, "us-west-2", "us-east-1"]));
    for (const rg of regionsToTry) {
      const b = `https://${rg}.recall.ai/api/v1`;
      try {
        info = await recallFetch(`${b}/bot/${botId}`, { method: "GET" });
        if (info) break;
      } catch (e) { continue; }
    }

    // Try inline transcripts if present
    const inline = info?.transcripts?.[0]?.text || info?.transcript?.text;
    if (inline && typeof inline === "string" && inline.trim()) {
      return res.json({ transcript: inline });
    }

    // Try top-level transcripts with URLs
    const tryUrls: string[] = [];
    if (Array.isArray(info?.transcripts)) {
      for (const t of info.transcripts) {
        if (typeof t?.download_url === "string") tryUrls.push(t.download_url);
        if (typeof t?.url === "string") tryUrls.push(t.url);
        if (typeof t?.file_url === "string") tryUrls.push(t.file_url);
      }
    }

    // Try recordings shortcuts and nested transcripts
    const recs = Array.isArray(info?.recordings) ? info.recordings : [];
    for (const r of recs) {
      const urls = [
        r?.media_shortcuts?.transcript?.data?.download_url,
        r?.media_shortcuts?.transcript?.data?.provider_data_download_url,
        r?.media_shortcuts?.transcript?.data?.url,
        r?.media_shortcuts?.transcript?.download_url,
        r?.transcript?.download_url,
        r?.transcript?.url,
      ].filter(Boolean);
      tryUrls.push(...(urls as string[]));
      if (Array.isArray(r?.transcripts)) {
        for (const t of r.transcripts) {
          if (typeof t?.text === "string" && t.text.trim()) return res.json({ transcript: t.text });
          if (typeof t?.download_url === "string") tryUrls.push(t.download_url);
          if (typeof t?.url === "string") tryUrls.push(t.url);
          if (typeof t?.file_url === "string") tryUrls.push(t.file_url);
        }
      }
    }

    // Attempt to fetch any discovered URLs
    for (const u of tryUrls) {
      try {
        const body = await fetchWithAuthText(u, region);
        const parsed = extractTranscriptFromJsonString(body);
        if (parsed && parsed.trim()) return res.json({ transcript: parsed });
        if (body && body.trim() && typeof body === "string") return res.json({ transcript: body });
      } catch {}
    }

    // Final fallback: dedicated transcript endpoint
    try {
      const tr = await recallFetch(`${base}/bot/${botId}/transcript`, { method: "GET" });
      if (typeof tr === "string" && tr.trim()) return res.json({ transcript: tr });
      if (tr && typeof tr === "object") {
        const text =
          typeof (tr as any).text === "string" ? (tr as any).text :
          Array.isArray((tr as any).segments) ? (tr as any).segments.map((s: any) => s?.text).filter(Boolean).join(" ") :
          Array.isArray((tr as any).results) ? (tr as any).results.map((r: any) => r?.alternatives?.[0]?.transcript || r?.text).filter(Boolean).join(" ") :
          "";
        if (text && text.trim()) return res.json({ transcript: text });
      }
    } catch {}

    return res.status(404).json({ error: "Transcript not available" });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Transcript error" });
  }
};

export const getParticipants: RequestHandler = async (req, res) => {
  try {
    const { botId } = req.query as { botId?: string };
    if (!botId) return res.status(400).json({ error: "botId required" });

    const store = readStore();
    const b = store.recallBots.find((x) => x.botId === botId);
    const region = b?.region || RECALL_REGION;
    const base = `https://${region}.recall.ai/api/v1`;

    let info: any = null;
    try {
      info = await recallFetch(`${base}/bot/${botId}`, { method: "GET" });
    } catch {}

    const urls: string[] = [];
    const recs = Array.isArray(info?.recordings) ? info.recordings : [];
    for (const r of recs) {
      const u = r?.media_shortcuts?.participant_events?.data?.participants_download_url
        || r?.media_shortcuts?.participant_events?.participants_download_url
        || r?.participant_events?.participants_download_url;
      if (typeof u === "string") urls.push(u);
    }
    const top = (info && (info.participant_events || info.participants)) as any;
    if (top && typeof top?.participants_download_url === "string") urls.push(top.participants_download_url);

    const parseParticipants = (text: string) => {
      const list: Array<{ email?: string; name?: string }> = [];
      try {
        const obj = JSON.parse(text as any);
        const arr = Array.isArray(obj) ? obj : Array.isArray((obj as any)?.participants) ? (obj as any).participants : [];
        if (Array.isArray(arr)) {
          for (const p of arr) {
            const email = (p?.email || p?.user_email || p?.mail || p?.address || "").toString();
            const name = (p?.name || p?.display_name || p?.user_name || p?.username || p?.full_name || "").toString();
            if (email || name) list.push({ email: email || name, name: name || undefined });
          }
          if (list.length) return list;
        }
      } catch {}
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length) {
        const header = lines[0].split(/,|\t/).map((h) => h.trim().toLowerCase());
        const idxEmail = header.findIndex((h) => /email/.test(h));
        const idxName = header.findIndex((h) => /name/.test(h));
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(/,|\t/).map((c) => c.trim());
          const n = idxName >= 0 ? cols[idxName] : undefined;
          const e = idxEmail >= 0 ? cols[idxEmail] : undefined;
          if (e || n) list.push({ email: e || n || "", name: n });
        }
        if (list.length) return list;
      }
      const rx = /([^,\n<]+)?\s*<([^>]+@[^>]+)>/g;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(text))) {
        const name = (m[1] || "").trim();
        const email = (m[2] || "").trim();
        list.push({ email: email || name, name: name || undefined });
      }
      return list;
    };

    for (const u of urls) {
      try {
        const body = await fetchWithAuthText(u, region);
        const parts = parseParticipants(body);
        if (parts.length) {
          const seen = new Set<string>();
          const unique = parts.filter((p) => {
            const key = (p.email || p.name || '').toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key); return true;
          });
          return res.json({ participants: unique });
        }
      } catch {}
    }

    return res.json({ participants: [] });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Participants error" });
  }
};
