export interface NewsItem {
  id: string;
  title: string;
  source: string;
  category: string; // "overview" | "defense" | "strategic" | "domestic" | "space" | "local"
  pubDate: string;
  summary: string;
  link: string;
  imageUrl?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  isAllDay: boolean;
  account?: string; // email address of the Google account this event belongs to
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type EmailPriority = "High" | "Medium" | "Low";

export interface EmailMessage {
  id: string;
  account: "primary" | "secondary";
  accountEmail: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  bodyPreview: string;
  priority: EmailPriority;
  summary: string;
}

export interface NewsletterSummary {
  id: string;
  subject: string;
  date: string;
  bullets: string[];
  source: "politico" | "dow" | "merge" | "asf";
  account: "primary" | "secondary";
  accountEmail: string;
}

export interface SavedItem {
  id: string;
  type: "article" | "newsletter-bullet";
  title: string;
  content: string;
  source: string;
  link?: string;
  savedAt: string;
}

export type AppTheme = "nightwatch" | "amber" | "arctic" | "mission";

export interface UserPrefs {
  role: string;
  priorityTopics: string[];
  deprioritizeTopics: string[];
  watchlist: string[];
  // Email triage overrides. Each entry is either a full email
  // (`john@example.com`) or a bare domain (`example.com`); domain rules
  // also match subdomains. Applied deterministically after Claude
  // classification — see app/api/gmail/route.ts.
  vipSenders: string[];   // force priority = High
  muteSenders: string[];  // force priority = Low
  localFeedKey: string;   // determines which RSS feeds show in "local" tab
  localZipcode: string;   // raw zipcode entered by user (5-digit US or OCONUS key)
  localCity: string;      // resolved display name e.g. "Colorado Springs, CO"
  localLat: number | null;
  localLon: number | null;
  theme: AppTheme;
  timezone: string;  // IANA timezone e.g. "America/Chicago"
  lastUpdated: string;
}

export interface CachedEmailClassification {
  id: string;
  accountEmail: string;
  priority: EmailPriority;
  summary: string;
  promptHash: string;
}

export interface ActionItem {
  emailId: string;
  from: string;
  subject: string;
  action: string;
  dueDate?: string;
}

export interface GoogleTask {
  id: string;
  title: string;
  status: "needsAction" | "completed";
  due?: string;        // RFC 3339 timestamp ("2026-05-20T00:00:00.000Z")
  notes?: string;
  completed?: string;
  updated: string;
}

export interface NewsThread {
  label: string;
  headline: string;
  summary: string;
  trend: "rising" | "stable" | "fading";
  articleIds: string[];
  sources: string[];
  newsletterContext?: string;
}

export interface ThreadsResult {
  throughLine: string;
  threads: NewsThread[];
}
