# Dashboard Roadmap

Ten ideas to make this dashboard learn behaviour, assist with duties, and save
time. Status legend: ✅ shipped · 🛠 in progress · 📋 planned. Numbers are
stable references that can be quoted in future sessions ("ship #5 next").

---

## Learn — passive signals → smarter ranking

### 1. ✅ Email triage cache + personalised prompt + VIP / mute lists
**Status:** Shipped on `claude/dead-web-dashboard-refactor-16sA7` (`9825cec`).
Cache classifications by Gmail message id, inject user prefs into the
classifier prompt, deterministic Always-High / Always-Low sender overrides.

### 2. ✅ Implicit feedback on articles + newsletters
**Status:** Shipped. Newsletter expand was already tracked (existing
`/api/newsletter-feedback "opened"` → `incrementOpenCount` → sort).
Article opens now feed `lib/articlePrefs.recordOpen` via the same
`/api/article-feedback` route at ~¼ the weight of explicit thumbs.
Client-side localStorage dedup keeps re-clicks in a 7-day window from
multi-boosting.

### 3. ✅ Suggested VIPs from reply patterns
**Status:** Shipped. Scans primary account `in:sent newer_than:30d` (top
200 sent messages by Gmail metadata) and surfaces senders the user has
replied to ≥3 times as "Suggested VIPs" above the action-items panel.
Add VIP appends to `user_prefs.vipSenders`; Dismiss appends to a new
`user_prefs.dismissed_vip_suggestions` field. Server-side
`vip_suggestions_cache` keyed by account_email with 12 h TTL.

### 4. ✅ Action items → Google Tasks
**Status:** Shipped this push. Per extracted action item from
`/api/gmail/actions`, surface an "Add to Tasks" button on the EmailTab action
list; one click pushes to Google Tasks via the existing `/api/tasks` POST.

---

## Assist — proactive help with daily work

### 5. ✅ Morning auto-brief (partial — cached, not cron'd)
**Status:** Shipped server-side caching. `/api/briefing` persists the
generated briefing in a new `briefing_cache` table keyed by
`YYYY-MM-DD` in the user's timezone; later same-day calls return the
cache instantly with no Claude cost. A "↻ Refresh" button in
`BriefingModal` busts the cache via `?refresh=1` when the headlines
have shifted. **Skipped:** a true cron-prefetch at 05:30 — that would
need OAuth-refresh-token plumbing the dashboard doesn't currently do.
The client-side prefetch + server-side date cache covers the practical
case (any first-of-day open feeds the cache; subsequent opens any
device are instant).

### 6. ✅ Meeting prep auto-context
**Status:** Shipped. `lib/calendar.ts` now exposes non-self attendee
emails on each `CalendarEvent`. Expanding an event in `CalendarPanel`
that has attendees shows a "📋 Prep" button. Clicking it calls a new
`/api/meeting-prep` endpoint that runs `from:{email} newer_than:60d`
Gmail searches in parallel (top 3 per attendee, metadata-only) and
returns subject / sender / date / snippet per result. Renders inline
under the event. Skipped for v1: cross-referencing against loaded
articles by topic — could come later.

---

## Save time — eliminate friction

### 7. ✅ Quick-capture box
**Status:** Shipped this push. One always-accessible textarea / modal that
Claude classifies into `{task, event, note}` and routes accordingly. Used
dozens of times a day; removes the "which app do I put this in" decision.

### 8. ✅ Quiet-newsletter suggestions
**Status:** Shipped (newsletter-scoped). `/api/newsletters` returns a
`quietSubjects[]` array listing normalised series subjects in the current
load whose `newsletter_prefs.openCounts[key]` is 0 (never expanded).
NewsletterSection renders an inline prompt above the section header:
"N newsletter series you've never opened" with "Hide series" (rolls
matching ids into the existing LS_DISMISSED localStorage list) or
"Ignore" (persists in a new LS_QUIET_DISMISSED list so the prompt
doesn't recur). Skipped for v1: actual `List-Unsubscribe` header
clicking — too many newsletters implement that as `mailto:` which is
browser-dependent. Hiding the series in-app gets you the same end state
without the surprise.

### 9. ✅ "What changed since I last looked"
**Status:** Shipped. New `surface_state` table records last visit per
surface (`email`, `news`, `newsletters`). On page load, TabShell fetches
the snapshot and dims items older than the snapshot at 50–60% opacity
(hover restores to full). After 5 s of dwell on a tab, the server-side
timestamp is bumped so the *next* session inherits a fresh baseline.

---

## Compounding foundation

### 10. ✅ Persistent memory layer for the AI assistant
**Status:** Shipped this push. Long-running document that auto-updates from
chat conversations (ongoing projects, upcoming events, named people, ad-hoc
preferences). Injected into every AI surface — each interaction makes the
next one smarter. View / edit / clear from Preferences.

---

## Currently shipped on the working branch

`claude/dead-web-dashboard-refactor-16sA7`:

| Commit | What |
|---|---|
| `d3bde01` | Newsletter summarisation → Sonnet (fix empty-bullet items) |
| `6f087e3` | DEAD POOL skull-reticle favicon |
| `9825cec` | Email triage cache + personalised prompt + VIP/mute lists |
| `6882cc6` / `8979d1b` / `d0b10dd` | Memory layer + action items → Tasks + quick capture |
| `999fa6e` | Throttle memory updates; preview-then-confirm for quick capture |
| `a74c8a3` / `0e10e1b` | #2 implicit article opens + #9 "what changed since I last looked" |
| `a342005` | #3 Suggested VIPs from primary reply patterns |
| `c5895af` | #8 Quiet-newsletter suggestions |
| `bca7eb0` | #5 Cached daily briefing + manual refresh |
| _this push_ | #6 Meeting prep auto-context from attendees |
