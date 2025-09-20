import { useEffect, useMemo, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Link } from "react-router-dom";
import { store } from "@/lib/store";
import { CalendarEvent, Meeting } from "@/lib/types";
import { PlatformIcon } from "@/components/meeting-icons";
import { MeetingDetail } from "@/components/meeting-detail";
import { fetchWithRetry } from "@/lib/utils";
import { generateFollowupEmail, generatePost } from "@/lib/generate";

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function Index() {
  useEffect(() => {
    // Wipe any previously seeded/demo past meetings and events
    try {
      store.clearPastMeetings();
      if ((window as any).localStorage?.getItem('pm-events')) {
        store.clearEvents();
      }
      setAccountsKey((x) => x + 1);
    } catch {}
  }, []);

  const [accountsKey, setAccountsKey] = useState(0);
  const [srvAccounts, setSrvAccounts] = useState<Array<{id:string,email:string,displayName?:string}>>([]);
  const [srvEvents, setSrvEvents] = useState<any[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const accounts = useMemo(() => (srvAccounts.map(a=>({id:a.id,provider:"google" as const,email:a.email,displayName:a.displayName}))), [accountsKey, srvAccounts]);
  const events = useMemo(() => {
    if (!srvEvents.length) return [];
    const now = Date.now();
    const localById = new Map(store.getEvents().map((le) => [le.id, le] as const));
    const mapped = srvEvents.map((e) => {
      const local = localById.get(e.id);
      return { ...e, wantsNotetaker: local?.wantsNotetaker ?? false, recallBotId: local?.recallBotId };
    });
    return mapped.filter((e) => +new Date(e.start) >= now);
  }, [accountsKey, srvEvents]);
  const [srvMeetings, setSrvMeetings] = useState<Meeting[]>([] as any);
  const meetings = useMemo(() => srvMeetings, [srvMeetings]);
  const [pastLimit, setPastLimit] = useState(9);
  const visibleMeetings = useMemo(() => meetings.slice(0, Math.max(0, pastLimit)), [meetings, pastLimit]);
  const settings = store.getSettings();
  const [openMeeting, setOpenMeeting] = useState<Meeting | null>(null);
  const [social, setSocial] = useState<{linkedinConnected:boolean;facebookConnected:boolean}>({linkedinConnected:false, facebookConnected:false});

  const addGoogle = () => {
    window.location.href = "/api/oauth/google";
  };

  const lastFetchAtRef = useRef<Record<string, number>>({});
  const shouldSkip = (url: string, ms = 700) => {
    const k = url.split('?')[0];
    const now = Date.now();
    const last = lastFetchAtRef.current[k] || 0;
    if (now - last < ms) return true;
    lastFetchAtRef.current[k] = now;
    return false;
  };

  useEffect(() => {

    const load = async () => {
      try {
        const s = await fetchWithRetry('/api/social/status');
        if (s.ok) setSocial(await s.json());
      } catch {}
      // Accounts
      try {
        const accUrl = "/api/google/accounts";
        if (!shouldSkip(accUrl)) {
          const accRes = await fetchWithRetry(accUrl);
          if (accRes.ok) {
            const acc = await accRes.json();
            setSrvAccounts(Array.isArray(acc) ? acc : []);
            setAccountsError(null);
          } else {
            const txt = await accRes.clone().text();
            setAccountsError(txt || "Failed to load accounts");
            setSrvAccounts([]);
          }
        }
      } catch (e: any) {
        setAccountsError(e?.message || "Failed to load accounts");
        setSrvAccounts([]);
      }
      // Past meetings (server)
      try {
        const url = '/api/past-meetings?limit=200';
        if (!shouldSkip(url)) {
          const r = await fetchWithRetry(url);
          if (r.ok) setSrvMeetings(await r.json());
        }
      } catch {}

      // Events
      try {
        const evUrl = `/api/google/events?windowDays=${encodeURIComponent(String(settings.windowDays || 45))}&pastDays=14`;
        if (shouldSkip(evUrl)) return;
        const evRes = await fetchWithRetry(evUrl);
        if (evRes.ok) {
          const ev = await evRes.json();
          const list: any[] = Array.isArray(ev) ? ev : [];
          setSrvEvents(list);
          setEventsError(null);

          // Persist fetched events locally so we can track end/past state even if bot scheduling fails
          try {
            const localById = new Map(store.getEvents().map((e) => [e.id, e] as const));
            for (const e of list) {
              const prev = localById.get(e.id);
              const merged: CalendarEvent = { ...e, wantsNotetaker: prev?.wantsNotetaker ?? false, recallBotId: prev?.recallBotId };
              store.upsertEvent(merged);
            }
          } catch {}

          // Backfill recallBotId by matching server-tracked bots to events via meetingUrl
          try {
            const trackedRes = await fetchWithRetry('/api/recall/tracked');
            if (trackedRes.ok) {
              const bots = await trackedRes.json();
              if (Array.isArray(bots)) {
                const byUrl = new Map<string, any[]>();
                for (const b of bots) {
                  if (b?.meetingUrl) {
                    const arr = byUrl.get(b.meetingUrl) || [];
                    arr.push(b);
                    byUrl.set(b.meetingUrl, arr);
                  }
                }
                for (const e of list) {
                  if (!e.conferencingUrl) continue;
                  const matches = byUrl.get(e.conferencingUrl) || [];
                  if (matches.length && !e.recallBotId) {
                    const botId = matches[0].botId;
                    const updated: CalendarEvent = { ...e, wantsNotetaker: true, recallBotId: botId };
                    store.upsertEvent(updated);
                  }
                }
              }
            }
          } catch {}

          // Auto-scheduling disabled per user request; notetaker toggle remains off by default
        } else {
          const txt = await evRes.clone().text();
          setEventsError(txt || "Failed to load events");
          setSrvEvents([]);
        }
      } catch (e: any) {
        setEventsError(e?.message || "Failed to load events");
        setSrvEvents([]);
      }
    };
    load();
  }, [accountsKey, settings.windowDays]);

  // Auto-refresh events/accounts
  useEffect(() => {
    const interval = setInterval(() => setAccountsKey((x) => x + 1), Math.max(15, settings.pollSeconds || 60) * 1000);
    return () => clearInterval(interval);
  }, [settings.pollSeconds]);

  // Poll Recall for bot media and move finished meetings to Past
  useEffect(() => {
    let stop = false;
    const run = async () => {
      try {
        const localEvents = store.getEvents();
        // Build index of saved meetings to avoid re-fetching
        let saved = new Set<string>();
        try {
          const idxRes = await fetchWithRetry('/api/past-meetings/index');
          if (idxRes.ok) {
            const arr = await idxRes.json();
            saved = new Set(arr.map((x: any) => x.id));
          }
        } catch {}
        const existing = new Map(srvMeetings.map((m) => [m.id, m] as const));
        let changed = false;
        for (const e of localEvents) {
          const ended = Date.now() >= +new Date(e.end || e.start);
          let hasRecording = false;
          let hasTranscript = false;
          if (e.recallBotId) {
            try {
              const r = await fetchWithRetry(`/api/recall/poll?botId=${encodeURIComponent(e.recallBotId)}`);
              if (r.ok) {
                const data = await r.json();
                hasRecording = !!data.hasRecording;
                hasTranscript = !!data.hasTranscript;
              }
            } catch {}
          }

          if (!e.recallBotId || !(ended || hasRecording || hasTranscript)) continue;

          const prev = existing.get(e.id);
          const alreadySaved = saved.has(e.id);
          const needsTranscriptUpdate = alreadySaved && !prev?.transcript && hasTranscript;
          if (alreadySaved && !needsTranscriptUpdate) continue;

          let transcriptText = prev?.transcript ?? "";
          if (!transcriptText && e.recallBotId) {
            try {
              const tr = await fetchWithRetry(`/api/recall/transcript?botId=${encodeURIComponent(e.recallBotId)}`);
              if (tr.ok) {
                const data = await tr.json();
                if (data?.transcript) {
                  transcriptText = String(data.transcript);
                  hasTranscript = true;
                }
              }
            } catch {}
          }

          let attendees = Array.isArray(e.attendees) ? e.attendees : [];
          if ((!attendees || attendees.length === 0) && e.recallBotId) {
            try {
              const pr = await fetchWithRetry(`/api/recall/participants?botId=${encodeURIComponent(e.recallBotId)}`);
              if (pr.ok) {
                const data = await pr.json();
                const parts = Array.isArray(data?.participants) ? data.participants : [];
                const norm = parts.map((p: any) => ({ email: String(p?.email || p?.name || "").trim(), name: p?.name ? String(p.name) : undefined }))
                  .filter((p: any) => (p.email || p.name));
                const byKey = new Map<string, { email: string; name?: string }>();
                for (const a of norm) {
                  const key = (a.email || a.name || '').toLowerCase();
                  if (key && !byKey.has(key)) byKey.set(key, { email: a.email || a.name || '', name: a.name });
                }
                attendees = Array.from(byKey.values());
              }
            } catch {}
          }

          const meeting: Meeting = {
            id: e.id,
            eventId: e.id,
            accountId: e.accountId,
            platform: e.platform,
            title: e.title,
            start: e.start,
            attendees,
            transcript: transcriptText,
            media: {
              botId: e.recallBotId,
              hasRecording,
              hasTranscript,
              updatedAt: new Date().toISOString(),
            },
          };
          // Persist meeting to server so it shows in Past Meetings
          try {
            const resp = await fetchWithRetry('/api/past-meetings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(meeting),
            });
            if (!resp.ok) {
              console.error('Upsert past meeting failed', await resp.clone().text());
            } else {
              changed = true;
            }
          } catch (e) { console.error('Upsert past meeting error', e); }
          // Save meeting locally for content generation and offline cache
          store.saveMeeting(meeting);
          // Finalize: stop tracking this bot
          try {
            if (meeting.media?.botId) {
              await fetchWithRetry(`/api/recall/bot?botId=${encodeURIComponent(meeting.media.botId)}`, { method: 'DELETE' });
              // Clear local bot link so we stop polling this event
              const cleared: CalendarEvent = { ...e, wantsNotetaker: false, recallBotId: undefined } as any;
              store.upsertEvent(cleared);
            }
          } catch {}
          // Ensure a single draft per platform is generated from Automations
          const existingContent = store.getContent(meeting.id);
          if (!existingContent) {
            const autos = store.getAutomations();
            const liTpl = autos.find((a) => a.platform === "linkedin")?.template;
            const fbTpl = autos.find((a) => a.platform === "facebook")?.template;
            const follow = generateFollowupEmail(meeting.transcript);
            const liDraft = generatePost(meeting.transcript, "linkedin", liTpl);
            const fbDraft = generatePost(meeting.transcript, "facebook", fbTpl);
            store.saveContent({
              meetingId: meeting.id,
              followupEmail: follow,
              posts: [
                { id: crypto.randomUUID(), platform: "linkedin", content: liDraft },
                { id: crypto.randomUUID(), platform: "facebook", content: fbDraft },
              ],
            });
          }
        }
        if (changed) {
          const url = '/api/past-meetings?limit=200';
          try { if (!shouldSkip(url, 1000)) { const r = await fetchWithRetry(url); if (r.ok) setSrvMeetings(await r.json()); } } catch {}
          setAccountsKey((x) => x + 1);
        }
      } catch {}
      if (!stop) timer = setTimeout(run, 30000);
    };
    let timer: any = setTimeout(run, 3000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [accountsKey]);

  const toggleNotetaker = async (ev: CalendarEvent, checked: boolean) => {
    const updated: CalendarEvent = { ...ev, wantsNotetaker: checked };
    if (!checked) updated.recallBotId = undefined;
    // Optimistic local update so UI reflects immediately
    store.upsertEvent(updated);
    setAccountsKey((x) => x + 1);

    if (checked && ev.conferencingUrl) {
      try {
        const minutes = settings.minutesBeforeJoin ?? 5;
        const startMs = +new Date(ev.start);
        const joinAt = new Date(Math.max(Date.now(), startMs - minutes * 60 * 1000)).toISOString();
        const eventKey = ev.id;
        const res = await fetchWithRetry("/api/recall/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventKey, meetingUrl: ev.conferencingUrl, platform: ev.platform, joinAt, region: settings.recallRegion }),
        });
        if (res.ok) {
          const data = await res.json();
          const withBot: CalendarEvent = { ...updated, recallBotId: data.botId };
          store.upsertEvent(withBot);
          setAccountsKey((x) => x + 1);
          setActionError(null);
        } else {
          const msg = await res.clone().text();
          const reverted: CalendarEvent = { ...updated, wantsNotetaker: false, recallBotId: undefined };
          store.upsertEvent(reverted);
          setAccountsKey((x) => x + 1);
          setActionError(msg || "Failed to schedule notetaker");
        }
      } catch (e: any) {
        const reverted: CalendarEvent = { ...updated, wantsNotetaker: false, recallBotId: undefined };
        store.upsertEvent(reverted);
        setAccountsKey((x) => x + 1);
        setActionError(e?.message || "Failed to schedule notetaker");
      }
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(60%_60%_at_0%_0%,hsl(var(--accent))_0,transparent_60%),radial-gradient(60%_60%_at_100%_100%,hsl(var(--accent))_0,transparent_60%)]">
      <header className="sticky top-0 z-40 backdrop-blur border-b bg-background/70">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8">
              <img src="/favicon.svg" alt="PostMeeting" className="w-8 h-8 rounded-md" />
            </div>
            <div>
              <div className="font-extrabold tracking-tight">PostMeeting</div>
              <div className="text-xs text-muted-foreground">Post-meeting social media content generator</div>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link to="/settings"><Button variant="outline" size="sm">Settings</Button></Link>
          </nav>
        </div>
      </header>

      <main className="container py-8 grid gap-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Section title="Google Accounts" action={<Button size="sm" onClick={addGoogle}>{accounts.length ? "Connect another" : "Connect Google"}</Button>}>
            {accountsError && (
              <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive p-3 text-xs">{accountsError}</div>
            )}
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Connect one or more Google accounts to pull calendar events.</p>
            ) : (
              <ul className="divide-y">
                {accounts.map((a) => (
                  <li key={a.id} className="py-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-full bg-primary/10 grid place-items-center text-primary font-semibold">G</div>
                      <div>
                        <div className="text-sm font-medium">{a.email}</div>
                        <div className="text-xs text-muted-foreground">Calendar connected</div>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={async () => {
                      try {
                        await fetch(`/api/google/accounts/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
                        setSrvAccounts((prev) => prev.filter((x) => x.id !== a.id));
                        setSrvEvents([]);
                        setAccountsKey((x) => x + 1);
                      } catch {}
                    }}>Disconnect</Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Bot Lead Time" action={<Link to="/settings"><Button size="default">Edit</Button></Link>}>
            <p className="text-sm text-muted-foreground">Recall bot will join meetings {settings.minutesBeforeJoin} minutes before start.</p>
          </Section>

          <Section title="Social Connections" action={<Link to="/settings"><Button size="default">Manage</Button></Link>}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium">LinkedIn</div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${social.linkedinConnected ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>{social.linkedinConnected ? 'Connected' : 'Not connected'}</span>
                </div>
              </div>
              <div className="rounded-md border p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Facebook</div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${social.facebookConnected ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>{social.facebookConnected ? 'Connected' : 'Not connected'}</span>
                </div>
              </div>
            </div>
          </Section>
        </div>

        <Section title="Upcoming Events" action={<span className="text-xs text-muted-foreground">Toggle notetaker per meeting</span>}>
          {actionError && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive p-3 text-xs flex items-start justify-between gap-3">
              <div className="whitespace-pre-wrap">{actionError}</div>
              <button className="text-[11px] underline" onClick={() => setActionError(null)}>Dismiss</button>
            </div>
          )}
          {eventsError && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive p-3 text-xs">
              {eventsError}
            </div>
          )}
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming events found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2">When</th>
                    <th className="py-2">Title</th>
                    <th className="py-2 hidden sm:table-cell">Platform</th>
                    <th className="py-2 hidden md:table-cell">Attendees</th>
                    <th className="py-2 text-center">Notetaker</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id} className="border-t">
                      <td className="py-2 md:py-3 whitespace-nowrap text-xs md:text-sm">{new Date(ev.start).toLocaleString()}</td>
                      <td className="py-2 md:py-3 text-sm truncate max-w-[160px] md:max-w-none">{ev.title}</td>
                      <td className="py-2 md:py-3 hidden sm:table-cell"><div className="flex items-center gap-2"><PlatformIcon platform={ev.platform} />{ev.platform}</div></td>
                      <td className="py-2 md:py-3 hidden md:table-cell truncate max-w-[180px]">{ev.attendees.map((a) => a.name ?? a.email).join(", ")}</td>
                      <td className="py-2 md:py-3 text-center">
                        <div className="inline-flex items-center gap-2">
                          <Switch checked={ev.wantsNotetaker} onCheckedChange={(c) => toggleNotetaker(ev, c)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Past Meetings" action={<span className="text-xs text-muted-foreground">Click to view transcript & AI drafts</span>}>
          {meetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No past meetings yet.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleMeetings.map((m) => {
                const names = (m.attendees || []).map((a) => a.name || a.email);
                const showNames = names.slice(0, 2);
                const more = Math.max(0, names.length - showNames.length);
                const avatars = (m.attendees || []).slice(0, 3);
                const initials = (s: string) => {
                  const n = s.includes('@') ? s.split('@')[0] : s;
                  const parts = n.trim().split(/\s+/);
                  const first = parts[0]?.[0] || '';
                  const second = parts[1]?.[0] || '';
                  return (first + second || first || '?').toUpperCase();
                };
                const status = m.media;
                return (
                  <button key={m.id} onClick={() => setOpenMeeting(m)} className="group text-left rounded-lg border p-3 md:p-4 hover:border-primary/50 hover:shadow-sm transition flex flex-col gap-2 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <PlatformIcon platform={m.platform} />
                        <span>{new Date(m.start).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {status?.hasRecording && <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px]">Recording</span>}
                        {status?.hasTranscript && <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-[10px]">Transcript</span>}
                        {!(status?.hasRecording || status?.hasTranscript) && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
                            <svg viewBox="0 0 24 24" className="w-3 h-3"><circle cx="12" cy="12" r="10" fill="currentColor" /></svg>
                            Processing…
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-1 font-medium line-clamp-1">{m.title}</div>

                    {avatars.length > 0 && (
                      <div className="mt-1 flex items-center gap-2">
                        <div className="flex -space-x-2">
                          {avatars.map((a, i) => (
                            <div key={i} className="inline-grid place-items-center w-6 h-6 rounded-full border bg-muted text-[10px] font-semibold text-muted-foreground">
                              {initials(a.name || a.email)}
                            </div>
                          ))}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {showNames.join(', ')}{more ? ` +${more} more` : ''}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
              {meetings.length > visibleMeetings.length && (
                <div className="col-span-full mt-1 flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => setPastLimit((n) => n + 9)}>Load more</Button>
                </div>
              )}
            </div>
          )}
        </Section>
      </main>

      <footer className="container py-8 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} PostMeeting</footer>

      {openMeeting && <MeetingDetail meeting={openMeeting} onClose={() => setOpenMeeting(null)} />}
    </div>
  );
}
