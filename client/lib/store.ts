import { Automation, CalendarEvent, GeneratedContent, Meeting, Platform, Settings, Account } from "./types";

const LS = {
  accounts: "pm-accounts",
  events: "pm-events",
  meetings: "pm-meetings",
  content: "pm-generated",
  settings: "pm-settings",
  automations: "pm-automations",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function initDemoData() {
  // Demo seeding disabled to avoid hardcoded sample data in production
  return;
}

export const store = {
  getAccounts(): Account[] {
    return read<Account[]>(LS.accounts, []);
  },
  addGoogleAccount(email: string, displayName?: string) {
    const accounts = store.getAccounts();
    const exists = accounts.find((a) => a.email === email);
    if (exists) return exists;
    const acc: Account = {
      id: crypto.randomUUID(),
      provider: "google",
      email,
      displayName,
    };
    write(LS.accounts, [...accounts, acc]);
    return acc;
  },
  getEvents(): CalendarEvent[] {
    // sort by start
    const list = read<CalendarEvent[]>(LS.events, []);
    return list.sort((a, b) => +new Date(a.start) - +new Date(b.start));
  },
  upsertEvent(ev: CalendarEvent) {
    const list = read<CalendarEvent[]>(LS.events, []);
    const idx = list.findIndex((e) => e.id === ev.id);
    if (idx === -1) list.push(ev);
    else list[idx] = ev;
    write(LS.events, list);
  },
  clearEvents() {
    write(LS.events, [] as CalendarEvent[]);
  },
  getUpcoming(): CalendarEvent[] {
    const now = Date.now();
    return store.getEvents().filter((e) => +new Date(e.start) >= now);
  },
  getPastMeetings(): Meeting[] {
    return read<Meeting[]>(LS.meetings, []).sort((a, b) => +new Date(b.start) - +new Date(a.start));
  },
  setPastMeetings(list: Meeting[]) {
    write(LS.meetings, list);
  },
  clearPastMeetings() {
    write(LS.meetings, [] as Meeting[]);
  },
  saveMeeting(m: Meeting) {
    const list = store.getPastMeetings();
    const idx = list.findIndex((x) => x.id === m.id);
    if (idx === -1) list.push(m);
    else list[idx] = m;
    write(LS.meetings, list);
  },
  getContent(meetingId: string): GeneratedContent | undefined {
    return read<GeneratedContent[]>(LS.content, []).find((c) => c.meetingId === meetingId);
  },
  saveContent(c: GeneratedContent) {
    const list = read<GeneratedContent[]>(LS.content, []);
    const idx = list.findIndex((x) => x.meetingId === c.meetingId);
    if (idx === -1) list.push(c);
    else list[idx] = c;
    write(LS.content, list);
  },
  clearAllContent() {
    write(LS.content, [] as GeneratedContent[]);
  },
  getSettings(): Settings {
    return read<Settings>(LS.settings, { minutesBeforeJoin: 5, windowDays: 45, pollSeconds: 60, recallRegion: "us-east-1", linkedInConnected: false, facebookConnected: false, linkedInTarget: "profile", facebookTarget: "page" });
  },
  saveSettings(s: Settings) {
    write(LS.settings, s);
  },
  getAutomations() {
    return read(LS.automations, [] as Automation[]);
  },
  saveAutomations(a: Automation[]) {
    write(LS.automations, a);
  },
};
