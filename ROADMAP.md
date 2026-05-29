# Dashboard Roadmap

Ideas to make this dashboard learn behaviour, assist with duties, and save
time. Status legend: ✅ shipped · 🛠 in progress · 📋 planned. Numbers are
stable references that can be quoted in future sessions ("ship #15 next").

---

## Foundation (all shipped)

### 1. ✅ Email triage cache + personalised prompt + VIP / mute lists
Shipped commit `9825cec`. See git log for detail.

### 2. ✅ Implicit feedback on articles + newsletters
Article opens nudge ranking via `recordOpen`; newsletter expands were
already wired. ~¼ of an explicit thumbs-up. Shipped `a74c8a3`.

### 3. ✅ Suggested VIPs from reply patterns
12 h server cache, primary account only. Shipped `a342005`.

### 4. ✅ Action items → Google Tasks
"+ Task" button on extracted email action items. Shipped `8979d1b`.

### 5. ✅ Morning auto-brief (cached daily)
`briefing_cache` table, keyed by date + timezone. Manual refresh
button busts the cache. Shipped `bca7eb0`. **Skipped:** true cron
prefetch (would need offline OAuth token refresh).

### 6. ✅ Meeting prep auto-context
"📋 Prep" expand on calendar events with attendees → top 3 recent
emails per attendee in parallel. 1 h cache. Shipped `2989d46`.

### 7. ✅ Quick-capture box (⌘K)
Two-step preview → confirm routing into task / event / memory note.
Shipped `d0b10dd` + `999fa6e`.

### 8. ✅ Quiet-newsletter suggestions
Hide newsletter series with 0 opens. Shipped `c5895af`.

### 9. ✅ "What changed since I last looked"
Per-surface lastSeen dimming. Shipped `0e10e1b`.

### 10. ✅ Persistent memory layer for the AI assistant
Auto-maintained markdown doc, debounced consolidation with persisted
pending-exchanges queue. Shipped `6882cc6` + `999fa6e` + `6989c4f`.

---

## Weather / Markets / OSINT tabs (this push)

### 11. ✅ Weather: multi-location dashboard
LocationCard grid + AlertsPanel + SpaceWeatherCard. NWS forecast,
NWS active alerts, NOAA SWPC (Kp + X-ray flares → G/R scale).
Shipped `f5b2ea6`.

### 12. ✅ Markets: custom watchlist + DOD contract awards
Editable `marketsWatchlist` from prefs becomes first TradingView
overview tab. New `/api/markets/contracts` parses defense.gov RSS
into vendor / branch / dollar-amount badges. Shipped `2d49f15`.

### 13. ✅ OSINT tab
Six panes: All / Social / Telegram / News / Aircraft / Maritime.
Aggregates user-configured RSS/Atom feeds; ADS-B Exchange + MarineTraffic
iframes centred on home. SSRF-hardened URL validation. Shipped `61441d6`.

---

## Documents / Notes module (next)

### 14. 🛠 Documents / Notes tab
Personal markdown wiki — see vision doc and detailed spec below.
Building this push.

---

## Planned — Productivity deep dives

### 15. 📋 Smart drafted replies
For unread High-priority emails Claude flags as needing a reply,
sample the user's `Sent` folder for voice + style, generate a draft.
"Use draft" inserts as a Gmail draft. **Effort:** medium-large.

### 16. 📋 Email follow-up tracker
Track outbound replies; if recipient hasn't responded in N days,
surface a "pending follow-up" card on the Email tab.
**Effort:** medium.

### 17. 📋 Voice quick-capture
Web Speech API on the capture modal — hands-free input mode.
**Effort:** small.

### 18. 📋 Cross-source convergence cards
When 3+ articles + email + calendar all touch the same topic, surface
a "convergence" card. Topic detection via the existing keyword
extractor. **Effort:** medium.

### 19. 📋 Anticipatory meeting briefings
Per tomorrow's calendar events, generate a Claude pre-read combining
meeting prep + news + memory. Morning card. **Effort:** medium.

### 20. 📋 Reading queue
Read-later inbox distinct from Saved. Estimated read time per item,
daily focus-block prompts. **Effort:** small-medium.

### 21. 📋 AI-suggested daily plan
Morning card: "given your calendar + tasks + briefing, here's a
suggested order." Editable. **Effort:** medium.

### 22. 📋 Conversation continuity
"Continue our last conversation" button on the chat; loads compressed
prior session as context. **Effort:** small.

### 23. 📋 Email scheduling
Write a reply now; schedule send for Monday 0700. Cron worker
dispatches. **Effort:** medium.

---

## Planned — Tab buildouts

### 24. 📋 Weather: aviation TAF/METAR for nearby military airfields
Decode current METAR + 24 h TAF inline per tracked location.
Closes the OCONUS gap. **Effort:** small-medium.

### 25. 📋 Weather: marine + climatology + ephemeris
Marine forecast for coastal locations; 30-day climatology departure;
sun/moon ephemeris per location. **Effort:** medium.

### 26. 📋 Markets: per-ticker deep-dive
Click a watchlist ticker → recent news + insider transactions +
earnings highlights inline. **Effort:** medium.

### 27. 📋 Markets: macro indicators + economic calendar
CPI / PPI / FOMC / yield-curve cards from FRED + this week's
release calendar. **Effort:** medium.

### 28. 📋 OSINT: Claude OSINT digest
Daily Claude summary of all OSINT feed content — one paragraph,
top 5 themes, top names mentioned. **Effort:** medium.

### 29. 📋 OSINT: per-feed search + saved-items integration
Search within feeds, save OSINT items to the Saved tab.
**Effort:** small.

---

## Planned — New modules

### 30. 📋 People / Contacts CRM
Auto-built from email threads. Per-person: last interaction, recent
emails, notes. Feeds VIP suggestions and meeting prep.
**Effort:** medium-large.

### 31. 📋 Maps / Geography
Leaflet map of recent news events plotted geographically. Filter by
category. Heat overlay. **Effort:** medium-large.

### 32. 📋 Research Topics
Topic-driven view: define a topic, the tab assembles articles +
newsletter mentions + saved items + notes touching it. Auto-updates.
**Effort:** large.

### 33. 📋 Logistics / Travel
Trip tracker with destination weather / currency / news / notes.
**Effort:** medium.

---

## Currently shipped on the working branch

`claude/dead-web-dashboard-refactor-16sA7`:

| Commit | What |
|---|---|
| `d3bde01` | Newsletter summarisation → Sonnet |
| `6f087e3` | DEAD POOL skull-reticle favicon |
| `9825cec` | Email triage cache + personalised prompt + VIP/mute lists |
| `6882cc6` / `8979d1b` / `d0b10dd` | Memory layer + action items → Tasks + quick capture |
| `999fa6e` | Throttle memory updates; preview-then-confirm for quick capture |
| `a74c8a3` / `0e10e1b` | Implicit article opens + "what changed since I last looked" |
| `a342005` | Suggested VIPs from primary reply patterns |
| `c5895af` | Quiet-newsletter suggestions |
| `bca7eb0` | Cached daily briefing + manual refresh |
| `2989d46` | Meeting prep auto-context from attendees |
| `04ac28c` → `e5533a0` | Code-review pass: 15 fixes across bugs / optimization / security |
| `8cf688d` | `docs/USER-GUIDE.html` |
| `f5b2ea6` | Weather: multi-location + NWS alerts + space weather |
| `2d49f15` | Markets: custom watchlist + DOD contract awards |
| `61441d6` | OSINT tab |
| _this push_ | Documents / Notes tab (#14) |

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
