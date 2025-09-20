import type { RequestHandler } from "express";

type SocialPlatform = "linkedin" | "facebook";

function extractHashtags(prompt: string) {
  const tags = new Set<string>();
  const rx = /#(\w{2,30})/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(prompt))) tags.add(`#${m[1]}`);
  return Array.from(tags);
}

function includesAny(s: string, words: string[]) {
  const lower = s.toLowerCase();
  return words.some((w) => lower.includes(w));
}

function desiredHashtagCount(prompt: string) {
  const lower = prompt.toLowerCase();
  const numMatch = lower.match(/(\d+)\s*hashtags?/);
  if (numMatch) return Math.min(5, Math.max(0, parseInt(numMatch[1], 10)));
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  for (const w in words) {
    if (lower.includes(`${w} hashtag`)) return words[w];
  }
  return 0;
}

function fillHashtags(prompt: string, platform: SocialPlatform) {
  const provided = extractHashtags(prompt);
  const wanted = desiredHashtagCount(prompt);
  const pool = platform === "linkedin"
    ? ["#Business", "#Insights", "#Leadership", "#Strategy", "#Growth"]
    : ["#Update", "#Community", "#Today", "#Highlights", "#Recap"];
  const result = [...provided];
  let i = 0;
  while (result.length < wanted && i < pool.length) {
    const tag = pool[i++];
    if (!result.includes(tag)) result.push(tag);
  }
  return result;
}

function generateTemplateFromPrompt(prompt: string, platform: SocialPlatform) {
  const cold = includesAny(prompt, ["cold"]);
  const wantsCasual = includesAny(prompt, ["casual", "friendly", "conversational", "warm"]);
  let wantsProfessional = includesAny(prompt, ["professional", "formal", "polished"]);
  const wantsConcise = includesAny(prompt, ["short", "concise", "brief", "succinct"]);
  const wantsEmoji = includesAny(prompt, ["emoji", "emojis", "\u{1F600}"]); // crude check

  if (cold) wantsProfessional = true; // cold tone takes precedence over conversational

  const tagsFinal = fillHashtags(prompt, platform);
  const baseHashtags = tagsFinal.length ? ` ${tagsFinal.join(" ")}` : "";

  if (platform === "linkedin") {
    let body = "";
    if (wantsConcise || wantsProfessional) {
      body = "Recap: {{topic}} — {{key_points}}. {{cta}}";
    } else if (wantsCasual) {
      body = "Great chat about {{topic}} — {{key_points}}. {{cta}}";
    } else {
      body = "After meeting about {{topic}}, key takeaways: {{key_points}}. {{cta}}";
    }
    const emoji = wantsEmoji && !wantsProfessional ? " ✨" : "";
    return `${body}${emoji}${baseHashtags}`.trim();
  }

  // facebook
  {
    let body = "";
    if (wantsConcise) {
      body = "{{topic}} — {{key_points}}. {{cta}}";
    } else if (wantsProfessional) {
      body = "Recap: {{topic}} — {{key_points}}. {{cta}}";
    } else {
      body = "Great chat today about {{topic}}! We covered {{key_points}}. {{cta}}";
    }
    const emoji = wantsEmoji || wantsCasual || platform === "facebook" ? " \uD83D\uDCA1" : ""; // 💡
    return `${body}${emoji}${baseHashtags}`.trim();
  }
}

async function openaiTemplate(prompt: string, platform: SocialPlatform) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const sys = `You generate social media post TEMPLATES that use placeholders. Output ONLY a single-line template string using these placeholders: {{topic}}, {{key_points}}, {{cta}}. Tailor to ${platform}. Do not include quotes or JSON. Keep under 260 chars. If user asks for hashtags or tone, include them.`;
  const user = `Make a template: ${prompt}`;
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  if (process.env.OPENAI_ORG) headers["OpenAI-Organization"] = process.env.OPENAI_ORG as string;
  if (process.env.OPENAI_PROJECT) headers["OpenAI-Project"] = process.env.OPENAI_PROJECT as string;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", messages: [{ role: "system", content: sys }, { role: "user", content: user }], temperature: 0.4, max_tokens: 200 }),
  });
  if (!r.ok) return null;
  const data: any = await r.json();
  const txt = data?.choices?.[0]?.message?.content?.trim();
  if (!txt) return null;
  return txt.replace(/^"|"$/g, "");
}

export const generateTemplate: RequestHandler = async (req, res) => {
  try {
    const { prompt, platform } = req.body as { prompt?: string; platform?: SocialPlatform };
    if (!prompt || !platform) return res.status(400).json({ error: "prompt and platform required" });

    let template: string | null = null;
    let provider: "openai" | "rules" = "rules";
    try { template = await openaiTemplate(prompt, platform); if (template) provider = "openai"; } catch {}
    if (!template) template = generateTemplateFromPrompt(prompt, platform);

    if (!template || typeof template !== "string") return res.status(500).json({ error: "failed to generate template" });
    res.json({ template, provider });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "template generation error" });
  }
};

async function openaiEmail(transcript: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  if (process.env.OPENAI_ORG) headers["OpenAI-Organization"] = process.env.OPENAI_ORG as string;
  if (process.env.OPENAI_PROJECT) headers["OpenAI-Project"] = process.env.OPENAI_PROJECT as string;
  const sys = "You draft concise, professional follow-up emails from a meeting transcript. Return JSON with keys: subject (string), body (string). The body MUST include: Recap: with 3-6 bullet points summarizing key points from the transcript, and Next steps: with 1-3 actionable items. Keep under 180 words. Avoid guarantees or performance claims.";
  const user = `Transcript:\n${transcript.slice(0, 8000)}`;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", messages: [{ role: "system", content: sys }, { role: "user", content: user }], temperature: 0.4, response_format: { type: "json_object" } }),
  });
  if (!r.ok) return null;
  const data: any = await r.json();
  const txt = data?.choices?.[0]?.message?.content;
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

export const generateEmail: RequestHandler = async (req, res) => {
  try {
    const { transcript } = req.body as { transcript?: string };
    if (!transcript) return res.status(400).json({ error: "transcript required" });
    let email: any = null;
    let provider: "openai" | "rules" = "rules";
    try { email = await openaiEmail(transcript); if (email) provider = "openai"; } catch {}
    if (!email) {
      const mod = await import("../../client/lib/generate");
      const s = mod.summarize(transcript);
      email = {
        subject: `Follow-up on ${s.topic}`,
        body: `Hi there,\n\nThanks again for the great conversation today. Here's a quick recap of what we covered:\n\n${s.keyPoints}\n\nNext steps:\n- I'll share any requested docs and timelines.\n- Please send over any additional questions.\n\nBest,\nYour Advisor`
      };
    }
    res.json({ ...email, provider });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "email generation error" });
  }
};
