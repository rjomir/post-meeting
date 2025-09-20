export type Platform = "zoom" | "teams" | "meet" | "unknown";

export interface Account {
  id: string; // stable id
  provider: "google";
  email: string;
  displayName?: string;
}

export interface CalendarEvent {
  id: string;
  accountId: string; // owning account
  title: string;
  start: string; // ISO
  end: string; // ISO
  attendees: { email: string; name?: string }[];
  conferencingUrl?: string; // zoom/teams/meet link
  platform: Platform;
  wantsNotetaker: boolean;
  recallBotId?: string; // if scheduled
}

export interface MeetingMediaStatus {
  botId: string;
  hasRecording: boolean;
  hasTranscript: boolean;
  updatedAt: string; // ISO
}

export interface Meeting {
  id: string; // same as event id
  eventId: string;
  accountId: string;
  platform: Platform;
  title: string;
  start: string;
  attendees: { email: string; name?: string }[];
  transcript: string;
  media: MeetingMediaStatus;
}

export type SocialPlatform = "linkedin" | "facebook";

export interface Automation {
  id: string;
  platform: SocialPlatform;
  name: string;
  enabled: boolean;
  template: string; // simple handlebars-like template
  description?: string; // prompt that can be used to generate the template
}

export interface GeneratedContent {
  meetingId: string;
  followupEmail: { subject: string; body: string };
  posts: Array<{
    id: string;
    platform: SocialPlatform;
    content: string;
    postedAt?: string; // ISO if posted
  }>;
}

export interface Settings {
  minutesBeforeJoin: number; // when to send notetaker
  windowDays: number; // how many days ahead to fetch events
  pollSeconds: number; // auto-refresh interval for calendar/events
  recallRegion?: string; // recall.ai region (e.g., us-west-2)
  linkedInConnected: boolean;
  facebookConnected: boolean;
  linkedInTarget?: "profile" | "organization";
  linkedInOrgUrn?: string;
  linkedInOrgName?: string;
}
