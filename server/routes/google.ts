import type { RequestHandler } from "express";
import { google } from "googleapis";
import { readStore, writeStore } from "../utils/persist";

const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
];

function getOAuth2(req: any) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing GOOGLE_CLIENT_ID/SECRET envs");
  const origin = process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
  const redirectUri = `${origin}/api/oauth/google/callback`;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export const startGoogleOAuth: RequestHandler = async (req, res) => {
  try {
    const oAuth2Client = getOAuth2(req);
    const url = oAuth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent", include_granted_scopes: true });
    res.redirect(url);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const googleCallback: RequestHandler = async (req, res) => {
  try {
    const err = (req.query.error as string) || "";
    if (err) {
      // User denied access or other OAuth error
      return res.redirect(`/?google_error=${encodeURIComponent(err)}`);
    }
    const code = req.query.code as string | undefined;
    if (!code) return res.status(400).json({ error: "OAuth code missing" });

    const oAuth2Client = getOAuth2(req);
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oAuth2Client, version: "v2" });
    const me = await oauth2.userinfo.get();
    const email = me.data.email || "unknown";
    const name = me.data.name || undefined;

    const store = readStore();
    const id = email;
    const existing = store.googleAccounts.find((a) => a.id === id);
    if (existing) existing.tokens = tokens;
    else store.googleAccounts.push({ id, email, displayName: name, tokens });
    writeStore(store);

    res.redirect("/");
  } catch (e: any) {
    try {
      return res.redirect(`/?google_error=${encodeURIComponent(e?.message || "oauth_failed")}`);
    } catch {}
    res.status(500).json({ error: e?.message || "oauth error" });
  }
};

export const listGoogleAccounts: RequestHandler = (_req, res) => {
  const store = readStore();
  res.json(store.googleAccounts.map(({ id, email, displayName }) => ({ id, email, displayName })));
};

export const listGoogleEvents: RequestHandler = async (req, res) => {
  const store = readStore();
  const origin = process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${origin}/api/oauth/google/callback`,
  );

  const pastDays = Math.max(0, Number((req.query.pastDays as string) || 0));
  const timeMin = new Date(Date.now() - pastDays * 24 * 60 * 60 * 1000).toISOString();
  const windowDays = Number((req.query.windowDays as string) || 45);
  const timeMax = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000).toISOString();

  type Platform = "zoom" | "meet" | "teams" | "unknown";
  const addPlatform = (text?: string): Platform => {
    const t = (text || "").toLowerCase();
    if (/zoom\.us|zoom\.com/.test(t)) return "zoom";
    if (/meet\.google/.test(t)) return "meet";
    if (/teams\.microsoft|teams\.live\.com/.test(t)) return "teams";
    return "unknown";
  };

  const isAllDay = (ev: any) => Boolean(ev.start?.date && !ev.start?.dateTime);
  const looksLikeNoise = (title?: string) => {
    const t = (title || "").toLowerCase();
    return t.includes("birthday") || t.includes("anniversary") || t.includes("holiday");
  };

  const firstUrlFromText = (text: string): string => {
    const m = text?.match(/https?:\/\/[^\s)]+/i);
    return m ? m[0] : "";
  };

  const all: any[] = [];
  const errors: Array<{ accountId: string; error: string }> = [];
  for (const acc of store.googleAccounts) {
    try {
      oAuth2Client.setCredentials(acc.tokens);
      const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

      // Fetch all calendars (not just primary)
      const calList = await calendar.calendarList.list({ maxResults: 250 });
      const cals = (calList.data.items || []).filter((c) => {
        const id = (c.id || "").toLowerCase();
        const summary = (c.summary || "").toLowerCase();
        const isHoliday = id.includes("holiday@") || summary.includes("holiday");
        const isContacts = id.includes("contacts#");
        const isResource = id.endsWith("resource.calendar.google.com");
        const readable = (c.accessRole || "reader") !== "freeBusyReader";
        return !isHoliday && !isContacts && !isResource && readable;
      });

      for (const cal of cals) {
        const { data } = await (calendar.events as any).list({
          calendarId: cal.id!,
          timeMin,
          timeMax,
          maxResults: 100,
          singleEvents: true,
          orderBy: "startTime",
          conferenceDataVersion: 1,
        });
        const items = (data.items || [])
          .filter((ev) => !isAllDay(ev) && !looksLikeNoise(ev.summary))
          .map((ev) => {
            const start = ev.start?.dateTime || ev.start?.date || new Date().toISOString();
            const attendees = (ev.attendees || []).map((a) => ({ email: a.email!, name: a.displayName || undefined }));

            const entryPoints = Array.isArray(ev.conferenceData?.entryPoints) ? ev.conferenceData!.entryPoints! : [];
            const entryPointUrl = (entryPoints
              .map((ep: any) => ep?.uri || ep?.label || "")
              .find((u: string) => /zoom\.us|meet\.google|teams\.microsoft|teams\.live\.com/i.test((u || "").toLowerCase())) || "") as string;

            const hangoutUrl = ev.hangoutLink || "";
            const locationUrl = firstUrlFromText(ev.location || "");
            const descriptionUrl = firstUrlFromText(ev.description || "");
            const summaryUrl = firstUrlFromText(ev.summary || "");

            const conferencingUrl = [entryPointUrl, hangoutUrl, locationUrl, descriptionUrl, summaryUrl].find((u) => !!u) || "";
            const textToScan = [conferencingUrl, ev.location || "", ev.description || "", ev.summary || "", ev.conferenceData?.conferenceSolution?.name || ""].join("\n");
            const platform = addPlatform(textToScan);

            return {
              id: `${acc.id}:${cal.id}:${ev.id}`,
              accountId: acc.id,
              title: ev.summary || "(no title)",
              start,
              end: ev.end?.dateTime || ev.end?.date || start,
              attendees,
              conferencingUrl,
              platform,
            };
          });
        all.push(...items);
      }
    } catch (e: any) {
      errors.push({ accountId: acc.id, error: e?.message || "failed to fetch" });
      continue;
    }
  }
  if (String(req.query.debug || "") === "1") {
    return res.json({ events: all, errors });
  }
  res.json(all);
};

export const revokeGoogleAccount: RequestHandler = async (req, res) => {
  const { id } = req.params as { id: string };
  const store = readStore();
  const acc = store.googleAccounts.find((a) => a.id === id);
  if (!acc) return res.status(404).json({ error: "account not found" });
  const token = acc.tokens?.refresh_token || acc.tokens?.access_token;
  try {
    if (token) {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
    }
  } catch {}
  // Remove locally
  store.googleAccounts = store.googleAccounts.filter((a) => a.id !== id);
  writeStore(store);
  res.status(204).end();
};
