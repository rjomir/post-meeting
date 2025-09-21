import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PlatformIcon } from "./meeting-icons";
import { GeneratedContent, Meeting } from "@/lib/types";
import { generateFollowupEmail, generatePost } from "@/lib/generate";
import { store } from "@/lib/store";

export function MeetingDetail({ meeting, onClose }: { meeting: Meeting; onClose: () => void }) {
  const [content, setContent] = useState<GeneratedContent | undefined>(store.getContent(meeting.id));
  const [transcript, setTranscript] = useState(meeting.transcript);
  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string } | null>(() => content?.followupEmail ?? null);
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailError, setEmailError] = useState<string | null>(null);
  const hasStoredEmail = Boolean(content?.followupEmail && (content.followupEmail.subject || content.followupEmail.body));
  const generateEmailDraft = async () => {
    if (hasStoredEmail) { setEmailDraft(content!.followupEmail!); setEmailLoading(false); return; }
    if (!transcript) { setEmailLoading(false); return; }
    try {
      setEmailLoading(true); setEmailError(null);
      const r = await fetch('/api/ai/generate-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript }) });
      if (r.ok) {
        const data = await r.json();
        if (data?.provider === 'openai' && data?.subject && data?.body) {
          setEmailDraft({ subject: String(data.subject), body: String(data.body) });
        } else if (data?.provider === 'rules') {
          setEmailError('AI is temporarily unavailable. Please try again later.');
        } else {
          setEmailError('AI did not return an email.');
        }
      } else {
        const t = await r.clone().text(); setEmailError(t || 'Failed to generate email');
      }
    } catch (e: any) { setEmailError(e?.message || 'Failed to generate email'); }
    finally { setEmailLoading(false); }
  };

  useEffect(() => {
    generateEmailDraft();
  }, [transcript, hasStoredEmail]);
  const [platform, setPlatform] = useState<"linkedin" | "facebook">("linkedin");
  const currentTemplate = useMemo(() => {
    try {
      const autos = store.getAutomations();
      return autos.find((a) => a.platform === platform)?.template;
    } catch { return undefined; }
  }, [platform]);
  const defaultPost = useMemo(() => generatePost(transcript, platform, currentTemplate), [transcript, platform, currentTemplate]);
  const [draft, setDraft] = useState(defaultPost);
  useEffect(() => {
    setDraft(defaultPost);
  }, [defaultPost]);
  const posted = content?.posts.find((p) => p.platform === platform)?.postedAt;

  const copy = async () => {
    await navigator.clipboard.writeText(currentTemplate || "");
  };
  const saveTemplateToSettings = () => {
    try {
      const autos = store.getAutomations();
      const updated = autos.map((a) => a.platform === platform ? { ...a, template: currentTemplate || a.template } : a);
      store.saveAutomations(updated);
      alert("Template saved to Settings");
    } catch (e: any) {
      alert(e?.message || "Failed to save template");
    }
  };
  const postNow = async () => {
    try {
      const settings = store.getSettings();
      if (platform === "linkedin") {
        const orgUrn = settings.linkedInTarget === 'organization' ? settings.linkedInOrgUrn : undefined;
        const res = await fetch("/api/social/linkedin/post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: draft, orgUrn }),
        });
        if (!res.ok) {
          const t = await res.clone().text();
          alert(t || "Failed to post to LinkedIn");
          return;
        }
      } else if (platform === "facebook") {
        const pageId = settings.facebookTarget === 'page' ? settings.facebookPageId : undefined;
        const res = await fetch("/api/social/facebook/post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: draft, pageId }),
        });
        if (!res.ok) {
          const t = await res.clone().text();
          alert(t || "Failed to post to Facebook");
          return;
        }
      }
      // Mark as posted locally
      const c = content ?? {
        meetingId: meeting.id,
        followupEmail: emailDraft ?? { subject: "", body: "" },
        posts: [],
      };
      const others = c.posts.filter((p) => p.platform !== platform);
      const updated: GeneratedContent = {
        ...c,
        posts: [...others, { id: crypto.randomUUID(), platform, content: draft, postedAt: new Date().toISOString() }],
      };
      store.saveContent(updated);
      setContent(updated);
    } catch (e: any) {
      alert(e?.message || "Failed to post");
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!transcript && meeting.media?.hasTranscript && meeting.media?.botId) {
        try {
          const r = await fetch(`/api/recall/transcript?botId=${encodeURIComponent(meeting.media.botId)}`);
          if (r.ok) {
            const data = await r.json();
            const text = String(data?.transcript || "");
            if (!cancelled && text) {
              setTranscript(text);
              store.saveMeeting({ ...meeting, transcript: text });
            }
          }
        } catch {}
      }
    };
    load();
    return () => { cancelled = true; };
  }, [meeting.media?.botId, meeting.media?.hasTranscript]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="fixed inset-0 bg-black/40 z-0" onClick={onClose} />
      <div className="relative z-10 ml-auto h-full w-full max-w-3xl bg-card shadow-xl overflow-y-auto overscroll-contain animate-in slide-in-from-right p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <PlatformIcon platform={meeting.platform} />
            <div>
              <h2 className="text-lg font-semibold">{meeting.title}</h2>
              <p className="text-sm text-muted-foreground">{new Date(meeting.start).toLocaleString()}</p>
            </div>
          </div>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="mt-6 grid gap-6">
          <section className="rounded-lg border p-4">
            <h3 className="font-medium mb-3">Transcript</h3>
            <p className="text-sm leading-6 whitespace-pre-wrap text-muted-foreground">{transcript}</p>
          </section>

          <section className="rounded-lg border p-4">
            <h3 className="font-medium mb-3">AI Draft Follow-up Email</h3>
            {emailLoading ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
                <span>Generating email…</span>
              </div>
            ) : (
              emailDraft ? (
                <div className="grid gap-2 text-sm">
                  <div className="font-semibold">Subject</div>
                  <input className="h-9 rounded-md border bg-background px-3 text-sm" value={emailDraft.subject} onChange={(e)=>setEmailDraft({ subject: e.target.value, body: emailDraft.body })} />
                  <div className="font-semibold mt-2">Body</div>
                  <textarea className="w-full min-h-32 text-sm rounded-md border bg-background p-3" value={emailDraft.body} onChange={(e)=>setEmailDraft({ subject: emailDraft.subject, body: e.target.value })} />
                  <div className="mt-2 flex items-center gap-2">
                    <Button variant="outline" onClick={async ()=>{ await navigator.clipboard.writeText(`Subject: ${emailDraft.subject}\n\n${emailDraft.body}`); }}>Copy</Button>
                  </div>
                  {emailError && <p className="text-xs text-destructive">{emailError}</p>}
                </div>
              ) : (
                <div className="grid gap-2 text-sm">
                  <p className="text-sm text-muted-foreground">No draft yet.</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button onClick={generateEmailDraft}>Generate</Button>
                  </div>
                  {emailError && <p className="text-xs text-destructive">{emailError}</p>}
                </div>
              )
            )}
          </section>

          <section className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">AI Draft Social Post</h3>
              <div className="flex items-center gap-3">
                <Label htmlFor="platform" className="text-xs text-muted-foreground">Platform</Label>
                <div className="flex gap-1 text-xs">
                  <Button variant={platform === "linkedin" ? "secondary" : "ghost"} size="sm" onClick={() => setPlatform("linkedin")}>LinkedIn</Button>
                  <Button variant={platform === "facebook" ? "secondary" : "ghost"} size="sm" onClick={() => setPlatform("facebook")}>Facebook</Button>
                </div>
              </div>
            </div>
            <textarea className="w-full min-h-32 text-sm rounded-md border bg-background p-3" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" onClick={copy}>Copy</Button>
              <Button variant="secondary" onClick={saveTemplateToSettings}>Save Template</Button>
              <Button onClick={postNow}>{posted ? "Posted" : "Post"}</Button>
            </div>
            {posted && <p className="mt-2 text-xs text-green-600">Posted on {new Date(posted).toLocaleString()}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
