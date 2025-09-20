import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import { startGoogleOAuth, googleCallback, listGoogleAccounts, listGoogleEvents, revokeGoogleAccount } from "./routes/google";
import { scheduleBot, pollBot, listTrackedBots, getTranscript, getParticipants } from "./routes/recall";
import { startLinkedInOAuth, linkedInCallback, unlinkLinkedIn, startFacebookOAuth, facebookCallback, unlinkFacebook, socialStatus, postLinkedIn, listLinkedInOrgs, listFacebookPages, postFacebook } from "./routes/social";
import { generateTemplate } from "./routes/ai";

export function createServer() {
  (async () => {
    try {
      const { ensureSchema } = await import("./utils/schema");
      await ensureSchema();
    } catch {}
    try {
      const { initPersistCache } = await import("./utils/persist");
      await initPersistCache();
    } catch {}
  })();
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/demo", handleDemo);

  // Google OAuth + Calendar
  app.get("/api/oauth/google", startGoogleOAuth);
  app.get("/api/oauth/google/callback", googleCallback);
  app.get("/api/google/accounts", listGoogleAccounts);
  app.get("/api/google/events", listGoogleEvents);
  app.delete("/api/google/accounts/:id", revokeGoogleAccount);

  // Recall.ai
  app.post("/api/recall/schedule", scheduleBot);
  app.get("/api/recall/poll", pollBot);
  app.get("/api/recall/tracked", listTrackedBots);
  app.get("/api/recall/transcript", getTranscript);
  app.get("/api/recall/participants", getParticipants);
  app.delete("/api/recall/bot", (require("./routes/recall") as any).finalizeBot);

  // Social OAuth + Status
  app.get("/api/oauth/linkedin", startLinkedInOAuth);
  app.get("/api/oauth/linkedin/callback", linkedInCallback);
  app.delete("/api/oauth/linkedin", unlinkLinkedIn);

  app.get("/api/oauth/facebook", startFacebookOAuth);
  app.get("/api/oauth/facebook/callback", facebookCallback);
  app.delete("/api/oauth/facebook", unlinkFacebook);

  app.get("/api/social/status", socialStatus);
  app.post("/api/social/linkedin/post", postLinkedIn as any);
  app.get("/api/social/linkedin/orgs", listLinkedInOrgs as any);
  app.get("/api/social/facebook/pages", listFacebookPages as any);
  app.post("/api/social/facebook/post", postFacebook as any);

  // Settings & Automations (DB)
  app.get("/api/settings", (require("./routes/settings") as any).getSettings);
  app.post("/api/settings", (require("./routes/settings") as any).saveSettings);
  app.get("/api/automations", (require("./routes/automations") as any).listAutomations);
  app.put("/api/automations", (require("./routes/automations") as any).replaceAutomations);

  // AI template generation
  app.post("/api/ai/generate-template", generateTemplate as any);
  app.post("/api/ai/generate-email", (require("./routes/ai") as any).generateEmail);

  // Past Meetings
  const meetings = require("./routes/meetings");
  app.get("/api/past-meetings", meetings.listPastMeetings);
  app.get("/api/past-meetings/index", meetings.indexPastMeetings);
  app.post("/api/past-meetings", meetings.upsertPastMeeting);

  return app;
}
