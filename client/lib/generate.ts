import { GeneratedContent, SocialPlatform } from "./types";

function sentences(text: string) {
  return text
    .split(/[.!?]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function summarize(text: string) {
  const s = sentences(text);
  const first = s[0] ?? text;
  const points = s.slice(1, 4).map((x) => `• ${x}`);
  return { topic: first.slice(0, 120), keyPoints: points.join(" \n"), cta: "DM me if you'd like a walkthrough." };
}

export function generateFollowupEmail(transcript: string): { subject: string; body: string } {
  const { topic, keyPoints } = summarize(transcript);
  const subject = `Follow-up on ${topic}`;
  const body = `Hi there,\n\nThanks again for the great conversation today. Here's a quick recap of what we covered:\n\n${keyPoints}\n\nNext steps:\n- I'll share any requested docs and timelines.\n- Please send over any additional questions.\n\nBest,\nYour Advisor`;
  return { subject, body };
}

export function applyTemplate(template: string, transcript: string) {
  const { topic, keyPoints, cta } = summarize(transcript);
  return template
    .replace(/{{\s*topic\s*}}/g, topic)
    .replace(/{{\s*key_points\s*}}/g, keyPoints.replace(/\n/g, " "))
    .replace(/{{\s*cta\s*}}/g, cta);
}

export function generatePost(transcript: string, platform: SocialPlatform, template?: string) {
  const base = template ?? (platform === "linkedin" ? "Takeaways: {{key_points}} — {{cta}}" : "We talked about {{topic}} — {{cta}}");
  return applyTemplate(base, transcript);
}

export function ensureGeneratedContent(meetingId: string, transcript: string): GeneratedContent {
  const email = generateFollowupEmail(transcript);
  const linkedin = generatePost(transcript, "linkedin");
  const facebook = generatePost(transcript, "facebook");
  return {
    meetingId,
    followupEmail: email,
    posts: [
      { id: crypto.randomUUID(), platform: "linkedin", content: linkedin },
      { id: crypto.randomUUID(), platform: "facebook", content: facebook },
    ],
  };
}
