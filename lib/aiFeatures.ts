import { AiFeature, UserPrefs } from "./types";

// Default: every feature ON. Switching the master off (or a per-feature
// toggle to false) flips this without needing a DB row write.
export const ALL_AI_FEATURES: AiFeature[] = [
  "chat", "news_chat",
  "email_triage", "email_actions", "email_draft", "email_convert",
  "osint_triage", "osint_situation",
  "doc_chat",
  "newsletters",
  "briefing", "digest", "threads",
  "news_overview",
  "news_thesis",
  "quick_capture",
  "markets_brief",
  "memory",
];

// Human-readable labels for the Preferences UI.
export const AI_FEATURE_LABELS: Record<AiFeature, { label: string; sub: string }> = {
  chat:          { label: "Chat assistant",            sub: "Calendar/tasks chat panel" },
  news_chat:     { label: "News chat",                 sub: "Right-rail news Q&A" },
  email_triage:  { label: "Email triage",              sub: "Per-email priority + summary" },
  email_actions: { label: "Email action items",        sub: "Extracts to-dos from unread mail" },
  email_draft:   { label: "Drafted replies",            sub: "Reply drafts in your voice — saved to Gmail Drafts, never sent" },
  email_convert: { label: "Email → task / event",       sub: "One-click convert an email into a Google Task or Calendar event" },
  osint_triage:  { label: "OSINT relevance scoring",    sub: "Per-item priority + reason on OSINT tab" },
  osint_situation: { label: "OSINT situation summary",  sub: "One-line 'what needs attention now' synthesis" },
  doc_chat:      { label: "Per-doc chat",               sub: "Ask Claude about the active document" },
  newsletters:   { label: "Newsletter summarisation",  sub: "Politico / DOW / Merge / ASF bullets" },
  briefing:      { label: "Morning brief",             sub: "Daily synthesis (cached once per day)" },
  digest:        { label: "Weekly digest",             sub: "Reading-pattern summary" },
  threads:       { label: "News threads",              sub: "Cross-article narrative extraction" },
  news_overview: { label: "News Overview curation",    sub: "Picks the day's must-reads for you" },
  news_thesis:   { label: "Article thesis button",     sub: "On-demand: Claude reads an article and states its core thesis" },
  quick_capture: { label: "Quick capture (⌘K)",        sub: "Routes free text → task / event / note" },
  markets_brief: { label: "Markets macro brief",       sub: "Daily news-driven macro read on the Markets tab" },
  memory:        { label: "Long-term memory updates",  sub: "Background consolidation after chat" },
};

// Single check used by every Claude-calling route. Fail-open if prefs lookup
// itself failed — losing prefs shouldn't silently kill AI everywhere. But
// log the case so a recurring prefs-fetch outage doesn't quietly defeat the
// user's master kill switch without anyone noticing.
export function isFeatureEnabled(feature: AiFeature, prefs: UserPrefs | null | undefined): boolean {
  if (!prefs) {
    console.warn(`[ai] prefs unavailable; defaulting "${feature}" to enabled`);
    return true;
  }
  if (prefs.aiEnabled === false) return false;
  const toggles = prefs.aiFeatureToggles ?? {};
  if (toggles[feature] === false) return false;
  return true;
}

// ─── Pricing ────────────────────────────────────────────────────────────────
// Per-token rates in micro-USD (10^-6 USD). One micro-USD per token equals
// $1 per million tokens. Cache creation = 1.25× base input; cache read = 0.1×
// base input. Update these if Anthropic publishes new pricing.
interface ModelRate {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

const RATES: Record<string, ModelRate> = {
  "claude-opus-4-7":    { input: 15,  output: 75,  cacheCreation: 18.75, cacheRead: 1.5  },
  "claude-opus-4-8":    { input: 15,  output: 75,  cacheCreation: 18.75, cacheRead: 1.5  },
  "claude-sonnet-4-6":  { input: 3,   output: 15,  cacheCreation: 3.75,  cacheRead: 0.3  },
  "claude-sonnet-4-7":  { input: 3,   output: 15,  cacheCreation: 3.75,  cacheRead: 0.3  },
  "claude-haiku-4-5":   { input: 1,   output: 5,   cacheCreation: 1.25,  cacheRead: 0.1  },
  "claude-haiku-4-6":   { input: 1,   output: 5,   cacheCreation: 1.25,  cacheRead: 0.1  },
};

const FALLBACK_RATE: ModelRate = { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 };

export function costMicrosFor(model: string, tokens: {
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
}): number {
  // Strip a `[Nm]` suffix or similar if it ever appears in the model id.
  const baseId = model.replace(/\[[^\]]*\]$/, "");
  const r = RATES[baseId] ?? FALLBACK_RATE;
  const micros =
    tokens.input  * r.input +
    tokens.output * r.output +
    (tokens.cacheCreation ?? 0) * r.cacheCreation +
    (tokens.cacheRead     ?? 0) * r.cacheRead;
  return Math.round(micros);
}
