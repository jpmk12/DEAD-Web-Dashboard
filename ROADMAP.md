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

### 3. 📋 Suggested VIPs from reply patterns
Track senders the user replies to within N minutes (Gmail API exposes thread
state). After 3 fast replies in 30 days, surface a card: "Add `x@y` to VIPs?"
Maintains the VIP list automatically. **Effort:** medium. **Touches:** Gmail
fetch (also pull Sent for reply detection), new `sender_signals` table,
`PreferencesDrawer` suggestion card.

### 4. ✅ Action items → Google Tasks
**Status:** Shipped this push. Per extracted action item from
`/api/gmail/actions`, surface an "Add to Tasks" button on the EmailTab action
list; one click pushes to Google Tasks via the existing `/api/tasks` POST.

---

## Assist — proactive help with daily work

### 5. 📋 Morning auto-brief, prefetched
Today the briefing is on-demand. Add a scheduled prefetch (~05:30 on
weekdays in the user's tz) that synthesises calendar + likely action items
+ top news + watchlist hits + weather. Ready when the user sits down.
**Effort:** medium. **Touches:** new background job in `server.js` (cron),
reuse `/api/briefing`, persist last brief.

### 6. 📋 Meeting prep auto-context
For each calendar event today, auto-pull: recent emails with attendees,
recent articles on the topic, last meeting's notes. Render as collapsible
panel per event. **Effort:** larger. **Touches:** `CalendarPanel`, new
`/api/meeting-prep` endpoint, Gmail search by `from:` filter.

---

## Save time — eliminate friction

### 7. ✅ Quick-capture box
**Status:** Shipped this push. One always-accessible textarea / modal that
Claude classifies into `{task, event, note}` and routes accordingly. Used
dozens of times a day; removes the "which app do I put this in" decision.

### 8. 📋 Smart unsubscribe / quiet-noise suggestions
Any sender with 0 opens over 30 days → surface "Unsubscribe?" with one-click
support via the `List-Unsubscribe` mail header. Inbox hygiene without manual
triage. **Effort:** small. **Touches:** sender-open tracking table, new
`/api/gmail/unsubscribe` endpoint, EmailTab suggestion row.

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
| `a74c8a3` / _this push_ | #2 implicit article opens + #9 "what changed since I last looked" |
