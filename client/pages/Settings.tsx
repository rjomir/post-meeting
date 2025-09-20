import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { store } from "@/lib/store";
import { Automation } from "@/lib/types";
import { Link } from "react-router-dom";
import { fetchWithRetry } from "@/lib/utils";

function LinkedInOrgPicker({ selectedUrn, onPick }: { selectedUrn?: string; onPick: (urn: string, name?: string) => void }) {
  const [orgs, setOrgs] = useState<Array<{ urn: string; name?: string }>>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetchWithRetry('/api/social/linkedin/orgs');
        if (r.ok) {
          const data = await r.json();
          setOrgs(Array.isArray(data) ? data : []);
        }
      } catch {}
    })();
  }, []);
  return (
    <div className="flex items-center gap-2">
      {orgs.length > 0 ? (
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={selectedUrn || ''} onChange={(e) => {
          const urn = e.target.value;
          const name = orgs.find(o=>o.urn===urn)?.name;
          onPick(urn, name);
        }}>
          <option value="">Select company page…</option>
          {orgs.map((o) => (<option key={o.urn} value={o.urn}>{o.name || o.urn}</option>))}
        </select>
      ) : (
        <input className="h-8 rounded-md border bg-background px-2 text-sm w-full" placeholder="urn:li:organization:123" value={selectedUrn || ''} onChange={(e) => onPick(e.target.value)} />
      )}
    </div>
  );
}

function FacebookPagePicker({ selectedId, onPick }: { selectedId?: string; onPick: (id: string, name?: string) => void }) {
  const [pages, setPages] = useState<Array<{ id: string; name?: string }>>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetchWithRetry('/api/social/facebook/pages');
        if (r.ok) {
          const data = await r.json();
          setPages(Array.isArray(data) ? data : []);
        }
      } catch {}
    })();
  }, []);
  return (
    <div className="flex items-center gap-2">
      {pages.length > 0 ? (
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={selectedId || ''} onChange={(e) => {
          const id = e.target.value;
          const name = pages.find(p=>p.id===id)?.name;
          onPick(id, name);
        }}>
          <option value="">Select Facebook page…</option>
          {pages.map((p) => (<option key={p.id} value={p.id}>{p.name || p.id}</option>))}
        </select>
      ) : (
        <input className="h-8 rounded-md border bg-background px-2 text-sm w-full" placeholder="Facebook Page ID" value={selectedId || ''} onChange={(e) => onPick(e.target.value)} />
      )}
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState(() => store.getSettings());
  const [autos, setAutos] = useState<Automation[]>(() => store.getAutomations());
  const [social, setSocial] = useState<{linkedinConnected:boolean;facebookConnected:boolean}>({linkedinConnected:false, facebookConnected:false});
  const [generating, setGenerating] = useState<Record<string, boolean>>({});

  const loadSocial = async () => {
    try {
      const r = await fetchWithRetry("/api/social/status");
      if (r.ok) setSocial(await r.json());
    } catch {}
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchWithRetry('/api/settings');
        if (r.ok) {
          const s = await r.json();
          setSettings((prev) => ({ ...prev, ...s }));
          store.saveSettings({ ...store.getSettings(), ...s });
        }
      } catch {}
      try {
        const r = await fetchWithRetry('/api/automations');
        if (r.ok) {
          const a = await r.json();
          if (Array.isArray(a) && a.length) {
            setAutos(a);
            store.saveAutomations(a);
          }
        }
      } catch {}
    })();
    loadSocial();
  }, []);

  const save = async () => {
    store.saveSettings(settings);
    store.saveAutomations(autos);
    try { await fetchWithRetry('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }); } catch {}
    try { await fetchWithRetry('/api/automations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(autos) }); } catch {}
    alert("Settings saved");
  };

  const addAutomation = (platform: "linkedin" | "facebook") => {
    setAutos((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        platform,
        name: `${platform} automation`,
        enabled: true,
        template: platform === "linkedin" ?
          "After meeting about {{topic}}, key takeaways: {{key_points}}. {{cta}} #FinancialPlanning" :
          "Great chat about {{topic}} — {{key_points}}. {{cta}}",
        description: platform === "linkedin"
          ? "Generate a concise, professional LinkedIn recap with a subtle CTA and one relevant hashtag."
          : "Generate a friendly, upbeat Facebook post with 1 emoji and a simple CTA.",
      },
    ]);
  };

  function localGenerateTemplate(prompt: string, platform: "linkedin" | "facebook") {
    const extractHashtags = (p: string) => {
      const tags = new Set<string>();
      const rx = /#(\w{2,30})/g; let m: RegExpExecArray | null;
      while ((m = rx.exec(p))) tags.add(`#${m[1]}`);
      return Array.from(tags);
    };
    const includesAny = (s: string, words: string[]) => {
      const lower = s.toLowerCase();
      return words.some((w) => lower.includes(w));
    };
    const desiredHashtagCount = (p: string) => {
      const lower = p.toLowerCase();
      const numMatch = lower.match(/(\d+)\s*hashtags?/);
      if (numMatch) return Math.min(5, Math.max(0, parseInt(numMatch[1], 10)));
      const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
      for (const w in words) if (lower.includes(`${w} hashtag`)) return words[w];
      return 0;
    };
    const fillHashtags = (p: string, plat: "linkedin" | "facebook") => {
      const provided = extractHashtags(p);
      const wanted = desiredHashtagCount(p);
      const pool = plat === "linkedin"
        ? ["#Business", "#Insights", "#Leadership", "#Strategy", "#Growth"]
        : ["#Update", "#Community", "#Today", "#Highlights", "#Recap"];
      const result = [...provided];
      let i = 0;
      while (result.length < wanted && i < pool.length) {
        const tag = pool[i++];
        if (!result.includes(tag)) result.push(tag);
      }
      return result;
    };

    const cold = includesAny(prompt, ["cold"]);
    const wantsCasual = includesAny(prompt, ["casual", "friendly", "conversational", "warm"]);
    let wantsProfessional = includesAny(prompt, ["professional", "formal", "polished"]);
    const wantsConcise = includesAny(prompt, ["short", "concise", "brief", "succinct"]);
    const wantsEmoji = includesAny(prompt, ["emoji", "emojis"]);

    if (cold) wantsProfessional = true;

    const tagsFinal = fillHashtags(prompt, platform);
    const baseHashtags = tagsFinal.length ? ` ${tagsFinal.join(" ")}` : "";

    if (platform === "linkedin") {
      const body = (wantsConcise || wantsProfessional)
        ? "Recap: {{topic}} — {{key_points}}. {{cta}}"
        : wantsCasual
        ? "Great chat about {{topic}} — {{key_points}}. {{cta}}"
        : "After meeting about {{topic}}, key takeaways: {{key_points}}. {{cta}}";
      const emoji = wantsEmoji && !wantsProfessional ? " ✨" : "";
      return `${body}${emoji}${baseHashtags}`.trim();
    } else {
      const body = wantsConcise ? "{{topic}} — {{key_points}}. {{cta}}" : wantsProfessional ? "Recap: {{topic}} — {{key_points}}. {{cta}}" : "Great chat today about {{topic}}! We covered {{key_points}}. {{cta}}";
      const emoji = wantsEmoji || wantsCasual ? " \uD83D\uDCA1" : "";
      return `${body}${emoji}${baseHashtags}`.trim();
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 backdrop-blur border-b bg-background/70">
        <div className="container flex h-16 items-center justify-between">
          <div className="font-semibold">Settings</div>
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/"><Button variant="ghost">Back</Button></Link>
            <Button onClick={save}>Save</Button>
          </nav>
        </div>
      </header>

      <main className="container py-8 grid gap-6 max-w-3xl">
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold mb-4">Recall.ai</h2>
          <div className="grid gap-3">
            <Label htmlFor="minutes">Bot lead time (minutes)</Label>
            <Input id="minutes" type="number" min={0} value={settings.minutesBeforeJoin}
              onChange={(e) => setSettings({ ...settings, minutesBeforeJoin: Math.max(0, Number(e.target.value || 0)) })} />
            <p className="text-xs text-muted-foreground">Bots will join Zoom/Meet/Teams links this many minutes before the event start.</p>
          </div>
          <div className="grid gap-3 mt-4">
            <Label htmlFor="window">Events window (days)</Label>
            <Input id="window" type="number" min={1} value={settings.windowDays}
              onChange={(e) => setSettings({ ...settings, windowDays: Math.max(1, Number(e.target.value || 1)) })} />
            <p className="text-xs text-muted-foreground">We will fetch meetings up to this many days ahead from Google Calendar.</p>
          </div>
          <div className="grid gap-3 mt-4">
            <Label htmlFor="recall-region">Recall region</Label>
            <select id="recall-region" className="h-9 rounded-md border bg-background px-3 text-sm"
              value={settings.recallRegion || "us-east-1"}
              onChange={(e) => setSettings({ ...settings, recallRegion: e.target.value })}>
              <option value="us-east-1">us-east-1</option>
              <option value="us-west-2">us-west-2</option>
              <option value="eu-central-1">eu-central-1</option>
            </select>
            <p className="text-xs text-muted-foreground">Choose the Recall.ai region where your account is created.</p>
          </div>
          <div className="grid gap-3 mt-4">
            <Label htmlFor="poll">Auto-refresh google calendar interval (seconds)</Label>
            <Input id="poll" type="number" min={15} value={settings.pollSeconds}
              onChange={(e) => setSettings({ ...settings, pollSeconds: Math.max(15, Number(e.target.value || 15)) })} />
            <p className="text-xs text-muted-foreground">Recommended: 60s. Lower values may hit API rate limits.</p>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold mb-4">Social connections</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg border p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">LinkedIn</div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${social.linkedinConnected ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                  {social.linkedinConnected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">OAuth needed to post as you.</p>
              {social.linkedinConnected && (
                <div className="grid gap-2 text-xs">
                  <div className="mt-1 font-medium text-sm">LinkedIn posting target</div>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2"><input type="radio" name="li-target" checked={(settings.linkedInTarget||'profile')==='profile'} onChange={() => setSettings({ ...settings, linkedInTarget: 'profile', linkedInOrgUrn: undefined, linkedInOrgName: undefined })}/> Profile</label>
                    <label className="inline-flex items-center gap-2"><input type="radio" name="li-target" checked={(settings.linkedInTarget||'profile')==='organization'} onChange={() => setSettings({ ...settings, linkedInTarget: 'organization' })}/> Company Page</label>
                  </div>
                  {settings.linkedInTarget === 'organization' && (
                    <LinkedInOrgPicker onPick={(urn,name)=> setSettings({ ...settings, linkedInOrgUrn: urn, linkedInOrgName: name })} selectedUrn={settings.linkedInOrgUrn} />
                  )}
                </div>
              )}
              {social.linkedinConnected ? (
                <div className="mt-auto pt-2">
                  <button className="text-xs text-primary underline underline-offset-4 hover:text-primary/80 cursor-pointer"
                    onClick={async () => { await fetch('/api/oauth/linkedin', { method: 'DELETE' }); await loadSocial(); }}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => { window.location.href = '/api/oauth/linkedin'; }}>Connect</Button>
                </div>
              )}
            </div>
            <div className="rounded-lg border p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">Facebook</div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${social.facebookConnected ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                  {social.facebookConnected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Connect your Facebook account (Pages supported for posting).</p>
              {social.facebookConnected && (
                <div className="grid gap-2 text-xs">
                  <div className="mt-1 font-medium text-sm">Facebook posting target</div>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2"><input type="radio" name="fb-target" checked={(settings.facebookTarget||'page')==='profile'} onChange={() => setSettings({ ...settings, facebookTarget: 'profile', facebookPageId: undefined, facebookPageName: undefined })}/> Profile</label>
                    <label className="inline-flex items-center gap-2"><input type="radio" name="fb-target" checked={(settings.facebookTarget||'page')==='page'} onChange={() => setSettings({ ...settings, facebookTarget: 'page' })}/> Page</label>
                  </div>
                  {settings.facebookTarget === 'page' && (
                    <FacebookPagePicker onPick={(id,name)=> setSettings({ ...settings, facebookPageId: id, facebookPageName: name })} selectedId={settings.facebookPageId} />
                  )}
                </div>
              )}
              {social.facebookConnected ? (
                <div className="mt-auto pt-2">
                  <button className="text-xs text-primary underline underline-offset-4 hover:text-primary/80 cursor-pointer"
                    onClick={async () => { await fetch('/api/oauth/facebook', { method: 'DELETE' }); await loadSocial(); }}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => { window.location.href = '/api/oauth/facebook'; }}>Connect</Button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold">Automations</h2>
          </div>
          {autos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No automations configured yet.</p>
          ) : (
            <div className="grid gap-3">
              {autos.map((a) => (
                <div key={a.id} className="rounded-md border p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{a.platform === 'linkedin' ? 'LinkedIn post template' : 'Facebook post template'}</div>
                  </div>
                  <div className="mt-3 grid gap-2">
                    <label className="text-xs text-muted-foreground">Description (AI prompt)</label>
                    <textarea
                      className="w-full min-h-20 text-sm rounded-md border bg-background p-2"
                      placeholder={a.platform === 'linkedin' ? 'e.g., Professional tone, concise recap, thank participants, subtle CTA, include 1 hashtag like #FinancialPlanning' : 'e.g., Friendly tone, upbeat, 1 emoji, simple CTA'}
                      value={a.description || ''}
                      onChange={(e) => setAutos((prev) => prev.map((x) => x.id === a.id ? { ...x, description: e.target.value } : x))}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!generating[a.id] || !(a.description && a.description.trim())}
                        onClick={async () => {
                          setGenerating((g) => ({ ...g, [a.id]: true }));
                          try {
                            const res = await fetchWithRetry("/api/ai/generate-template", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ prompt: a.description, platform: a.platform }),
                            });
                            if (res.ok) {
                              const data = await res.json();
                              const t = data?.template || '';
                              setAutos((prev) => prev.map((x) => x.id === a.id ? { ...x, template: t } : x));
                              if (data?.provider !== 'openai') alert('Used fallback generator (OpenAI unavailable).');
                            } else {
                              const fallback = localGenerateTemplate(a.description || '', a.platform);
                              setAutos((prev) => prev.map((x) => x.id === a.id ? { ...x, template: fallback } : x));
                              const t = await res.clone().text();
                              console.error("AI generation failed:", res.status, t);
                              alert("Server generation failed, used local generator.");
                            }
                          } catch (e: any) {
                            const fallback = localGenerateTemplate(a.description || '', a.platform);
                            setAutos((prev) => prev.map((x) => x.id === a.id ? { ...x, template: fallback } : x));
                            console.error(e);
                            alert("Network error, used local generator.");
                          } finally {
                            setGenerating((g) => ({ ...g, [a.id]: false }));
                          }
                        }}
                      >{generating[a.id] ? 'Generating…' : 'Generate'}</Button>
                    </div>
                  </div>
                  <label className="mt-4 block text-xs text-muted-foreground">Template</label>
                  <textarea className="mt-2 w-full min-h-24 text-sm rounded-md border bg-background p-2" value={a.template} onChange={(e) => setAutos((prev) => prev.map((x) => x.id === a.id ? { ...x, template: e.target.value } : x))} />
                  <p className="mt-2 text-xs text-muted-foreground">Use {'{{topic}}'}, {'{{key_points}}'}, {'{{cta}}'} placeholders.</p>
                </div>
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
