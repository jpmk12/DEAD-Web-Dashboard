# FEATURES.md — DEAD's Dashboard parity spec

A complete inventory of features in this web dashboard, organized to support
keeping a sibling application (mobile, desktop, etc.) at parity. Each section
gives the user-facing behavior, the data shapes and endpoints behind it, and
notes on caching / AI / external dependencies.

Last updated against the commit history of `claude/dead-web-dashboard-refactor-16sA7`.

---

## Stack

- **Frontend / SSR**: Next.js 15 (App Router), React 19, Tailwind CSS
- **Server**: custom `server.js` Next.js server (binds `process.env.PORT`)
- **Database**: managed MySQL via `mysql2` (`lib/db.ts`)
- **AI**: Anthropic SDK (`@anthropic-ai/sdk`); models in active use: `claude-opus-4-7`, `claude-haiku-4-5`
- **Auth**: NextAuth 5 with Google OAuth, single-user (allowlisted by `OWNER_EMAIL` env)
- **Maps**: React-Leaflet 5 + OpenStreetMap tiles (CartoDB dark variant) + OpenSeaMap overlay
- **Charts**: TradingView embeds (markets widget)
- **WebSocket**: `ws` package for the server-side AISStream connection
- **Zip**: `jszip` for the docs export

Deployment target: GoDaddy Node.js Hosting. Outbound network restricted to HTTP/HTTPS (443). Container is ephemeral — all state lives in the managed MySQL.

---

## Authentication

- Google OAuth (login + Gmail + Calendar + Tasks scopes)
- `OWNER_EMAIL` env var allowlists the only account allowed to sign in
- Secondary Gmail account connection (`GMAIL_SECONDARY_REDIRECT_URI`) — separate OAuth, surfaces in the Email tab and gets the same triage treatment as the primary
- Apple Calendar / iCal feed: session-authenticated URL the user subscribes from their calendar app

## Database schema

All tables live in a single managed MySQL instance. Migrations are idempotent (`CREATE TABLE IF NOT EXISTS` + `COLUMN_MIGRATIONS` array in `lib/db.ts`).

| Table | Purpose |
|---|---|
| `saved_items` | Bookmarked / kept news articles + newsletter bullets |
| `user_prefs` | All user preferences (single row, id=1) |
| `article_prefs` | Per-article thumbs up/down + open tracking — drives news sort |
| `newsletter_prefs` | Per-normalized-subject open counts — drives quiet-newsletter detection |
| `newsletter_cache` | Claude-summarized newsletter bullets (prompt-hashed) |
| `email_classification_cache` | Per-email priority + summary from Claude (prompt-hashed) |
| `osint_triage_cache` | Per-OSINT-item priority + reason from Claude (prompt-hashed) |
| `briefing_cache` | One-per-day Morning Brief, keyed by timezone-aware date |
| `vip_suggestions_cache` | Reply-pattern derived VIP suggestions |
| `user_memory` | Long-term memory markdown doc + pending exchanges queue |
| `surface_state` | Per-surface "last seen" timestamps for "what changed since I last looked" |
| `documents` | Markdown wiki notes (title, content, tags JSON, pinned, archived, timestamps) |
| `document_versions` | Last 25 snapshots per doc for restore (FK CASCADE on delete) |
| `document_links` | Wiki-link edges between docs + external link targets |
| `files` | File repo blobs (LONGBLOB), optional doc_id attach |
| `anthropic_usage` | Logged Claude API call for spend display (route, model, tokens, micros, created_at) |
| `thread_sessions` / `threads` | Saved Threads view history |
| `signal_daily_counts` | Trend layer: per-day term counts (topic/category/watch/region/aor/label), 180-day retention |
| `signal_seen` | Trend layer dedup ledger (sha1 of item id), 14-day retention |

---

## The seven tabs

### 1. News

**Purpose**: National-security / current-events news feed across ~20 configured RSS sources, sorted by user preference signals.

- **Source catalog**: `lib/newsSources.ts` — `BASE_NEWS_SOURCES` (always-on) + `LOCAL_NEWS_SETS` (keyed by `user_prefs.localFeedKey`)
- **Categories**: overview, defense, strategic, domestic, space, local
- **Endpoint**: `GET /api/news` — fetches every enabled feed in parallel, returns `{ items, sourceErrors, sourceStats }`
- **Per-source toggle**: `user_prefs.disabledNewsSources` (opt-out array of source names). Toggling skips the fetch entirely → reduces both bandwidth and the AI context size for news_chat/threads/briefing.
- **Per-source stats**: `sourceStats` returns `{ name, count, totalChars }` so the Preferences UI can show per-source items + estimated tokens.
- **Sort signal**: `lib/articlePrefs.ts` `sortByPreference()` boosts up-voted articles + sources, deprioritises down-voted; also applies watchlist matches.
- **Watchlist matching**: substring match on title (case-insensitive). Matched articles render a ⚑ Watch chip.
- **Card actions**: bookmark (★), save excerpt to Docs (▤), thumbs up/down (👍/👎). The first is per-article, the last two are persisted feedback signals.

**Client caching**: 15 min via `clientCache` (key `news:items`).

### 2. Calendar

**Purpose**: Google Calendar view + Google Tasks panel + iCal subscription URL for external apps.

- **Calendar source**: Google Calendar v3 API via `@googleapis/calendar`
- **Tasks source**: Google Tasks API via `@googleapis/tasks`
- **iCal feed**: `/api/calendar/ical?token=<sessionToken>` — generated `.ics` for external calendar app subscription
- **Right-rail chat**: chat panel that reads the user's calendar + tasks as system context, can add events / tasks via action-block syntax (`[ADD_EVENT:{...}]`, `[ADD_TASK:{...}]`)
- **AI feature toggle**: `chat` — turning it off makes the rail return "AI disabled"

### 3. Email

**Purpose**: AI-triaged unread inbox across primary + (optional) secondary Gmail accounts. Action-item extraction.

- **Source**: Gmail API (unread messages, last ~50 per account)
- **Endpoint**: `GET /api/gmail` — returns `{ emails: EmailMessage[], secondaryConnected }` with priorities applied
- **Triage**:
  - Claude classifies each email as High / Medium / Low with a 1-2 sentence summary
  - Cached in `email_classification_cache` keyed by `(id, account_email)` + `prompt_hash` (hash of `SYSTEM_PROMPT + userContext`)
  - VIP/mute overrides applied AFTER cache fetch — adding a VIP doesn't invalidate cache, the override layer just trumps
  - Model: `claude-haiku-4-5`
- **Action items**: separate `/api/gmail/actions` extracts tasks/follow-ups from unread emails. Each item shows + Task (Google Tasks) and ▤ Doc (promote to a tracking doc).
- **VIP/mute rules** (`lib/userPrefs.ts` `senderMatches`):
  - Full address (`john@example.com`) — exact match
  - Bare domain (`example.com`) — matches the domain and all subdomains
- **Suggested VIPs**: derived from reply patterns (`lib/replySignals.ts`); shown as dismissible suggestions
- **Save-to-Docs**: ▤ button on each card creates a doc with sender / account / date / AI summary / body preview / `## Notes` section. Tag: `email`.

**Client caching**: 10 min via `clientCache` (key `email:list`). Wiped on prefs save so VIP changes apply immediately.

### 4. Docs

**Purpose**: Personal markdown wiki with wiki-links, autosave, multi-perspective filtering, and a file repo.

#### Editor
- Markdown textarea + split-view preview (renders inline)
- Autosave 1.2s after last keystroke
- Keyboard shortcuts: ⌘B bold, ⌘I italic, ⌘K external link, ⌘[ wiki-link, ⌘F find/replace
- Slash command palette: `/h1`, `/h2`, `/h3`, `/quote`, `/task`, `/list`, `/ol`, `/code`, `/hr`, `/wiki`, `/link`, `/today`, `/now`
- Formatting toolbar: B/I/`<>` · H1/H2/H3 · •/1./☐ · "/{}/— · 🔗/[[ ]] · ? cheatsheet
- Wiki-links: `[[Doc Title]]` → button in preview, click opens (or creates) target doc; backlinks resolve automatically on save
- Task lists: `- [ ]` and `- [x]` render as clickable checkboxes that flip the source marker
- Find/replace bar: ⌘F opens; Find next / Replace / Replace all + case-sensitivity toggle
- TOC sidebar: ≣ button toggles; auto-extracted from `#…` headings, click to jump cursor + scroll
- Per-doc chat: 💬 Ask button opens a streaming panel scoped to just this doc; new feature toggle `doc_chat`
- Word count / read time strip at the bottom

#### Sidebar
- Search (FULLTEXT for ≥3 chars, LIKE for shorter)
- **Smart views** (persisted to localStorage + URL hash): All / Pinned / Recent (7d) / Stale (30d+) / Untagged / From email / From OSINT / From news / Action items / Archived. Each shows count in parens.
- **Sort**: Recent / Title A-Z / Longest (by word count). Pinned always float to top.
- **Clickable tag chips** on rows. Clicking adds the tag to the filter set. With 2+ tags active, an Any/All toggle (OR/AND) appears.
- **# Manage tags modal**: list every tag with usage count; per-row Rename / Merge / Delete across all docs. Wrapped in a single transaction.
- **Bulk actions**: checkbox column → action bar with Pin / Unpin / + Tag / − Tag / Archive (or Restore in archive view) / Del.
- **⬇ Export all**: zip of every doc as `.md` (active at root, archived under `archived/`).
- **Recent docs strip** above the editor (6 freshest, current doc excluded).
- **URL hash**: `#view=email&tags=foo,bar&tagmode=all&sort=title` — shareable filter state.

#### Per-doc affordances
- Pin toggle (★)
- Tag add/remove chips
- 📜 Version history button — modal showing last 25 snapshots (5-min throttle on creation). Restore writes the snapshot's content back AND snapshots the current state first so the restore is itself undoable.
- ⬇ MD button — download current doc as `.md` with YAML frontmatter
- ▢ Archive (or ↺ Restore in archive view) — soft-delete; hidden from default sidebar, recent strip, AND chat-assistant context. Stays restorable.
- 🗑 Delete — permanent

#### File repo
- 📝 Docs / 📁 Files toggle at the top of the sidebar
- Upload: button + drag-drop on the sidebar header
- Per-file limit: 30 MB
- Aggregate quota: 250 MB (color-coded usage bar)
- Storage: MySQL LONGBLOB (`files` table)
- Per-file metadata: filename, mime, size, description, tags, optional `doc_id` attachment
- Preview: images inline, PDFs in iframe, text/JSON/XML <200 KB as preformatted text, everything else → Download
- Auto-attach: when a doc is open in Docs mode, switching to Files attaches new uploads to that doc

#### Chat context integration
- The chat assistant's system block includes the 5 most-recently-updated docs (800 chars each, archived excluded)
- The per-doc chat panel reads the active doc body (capped at 20k chars) into the system block

### 5. OSINT

**Purpose**: Aggregated open-source intelligence — RSS-bridged social/news feeds plus self-rendered aircraft + maritime maps.

#### Feed panes
- **All / Social / Telegram / News**: RSS/Atom feeds aggregated and clustered (near-duplicate headlines collapse into one cluster with a `+N more from {feed A}, {feed B}` expand)
- **Aircraft / Maritime**: self-rendered Leaflet maps
- **Time-window filter**: All / 4h / 24h / 7d pill row
- **Watchlist highlight**: items matching `user_prefs.watchlist` get an orange tint + ⚑ Watch chip
- **AI triage**: `osint_triage` feature toggle — Claude rates each cluster (High/Medium/Low + short reason), cached in `osint_triage_cache` for 14 days keyed by prompt hash
- **Save to Docs**: ▤ button per cluster — captures primary item + dupes + triage call
- **Per-feed health dots** in Preferences (green/amber/red/slate based on last fetch status)
- **Test feed button** per feed row — POST `/api/osint/test-feed` returns diagnostics + suggested alternative bridge instances on failure
- **Suggested feeds catalog** in Preferences — curated list (`lib/osintSuggestions.ts`) with one-click + Add

#### Aircraft map
- **Source toggle**: Self-hosted (OpenSky Network) or Iframe provider (adsb.fi / airplanes.live / etc.)
- **Self-hosted**: `GET /api/osint/aircraft?lat&lon&radius` — proxies OpenSky `/api/states/all` with bounding box, 60s server cache
- **Military filter**: ICAO 24-bit address prefixes (AE/AF for US Mil) + common callsign regex (REACH/HAVOC/BLUE/KING/etc.)
- **Notable callsigns**: derived from `user_prefs.watchlist` — orange ⚑ markers
- **Markers**: SVG planes rotated by heading; colored red for mil, orange for notable, slate for civilian
- **Search-this-area**: button surfaces when map view drifts >25% off the active search; click re-queries at the current center+radius
- **AOI controls**: typed input accepts place name (geocoded via Nominatim through `/api/osint/geocode`) or `lat,lon`; numeric radius input (20-500 km); ⌂ Home button snaps back

#### Maritime map
- **Source toggle**: Self-hosted (AISStream) or Iframe provider (VesselFinder / MarineTraffic / OpenSeaMap)
- **Self-hosted**: requires `AISSTREAM_API_KEY` env. Server holds a long-lived WebSocket via `lib/aisStream.ts`; ships served from `/api/osint/ships`
- **Without API key**: banner over the base map directs to aisstream.io signup; iframe provider still works
- **Base layer**: dark CartoDB tiles + OpenSeaMap seamarks overlay
- **Markers**: triangles rotated by heading (fallback to course-over-ground); colored by ship type (cargo/tanker/passenger/fishing/etc.)
- **Notable names**: same watchlist source as aircraft; orange ⚑ markers
- **Same AOI controls as aircraft**

### 6. Markets

**Purpose**: Editable ticker watchlist + DOD daily contract awards feed.

- **Watchlist**: TradingView symbols (`EXCHANGE:TICKER`) stored in `user_prefs.marketsWatchlist`. Default: 5 defense primes (LMT/RTX/NOC/GD/BA)
- **TradingView widget**: tabbed overview with Watchlist / Indices / Energy & Metals
- **DOD contracts panel**: parsed from defense.gov RSS via `/api/markets/contracts`. Branch badge (ARMY/NAVY/USAF/USMC/Space Force/DLA/MDA), dollar amounts formatted (B/M/K)

### 7. Weather

**Purpose**: Multi-location forecasts, NWS alerts, NOAA space weather, Windy.com map.

- **Multi-location**: `user_prefs.trackedLocations` (up to 10, each with label+lat+lon)
- **Per-location card**: current temp, wind, short forecast, next 4 periods. NWS alerts chip (severity-coloured)
- **Aggregated alerts panel**: deduped across tracked locations, severity-sorted
- **Space weather**: Kp index sparkline + G-scale geomagnetic storm + flare class + R-scale radio blackout. Source: NOAA SWPC
- **Map**: Windy.com ECMWF embed with overlay selector (Wind/Rain/Temp/Clouds/Pressure)
- **METAR strip**: bottom-of-tab quick links to common mil airfields' METAR

---

## Top bar

### ◆ Morning Brief
- Daily synthesis of priority news + emails + calendar + actions
- Cached one-per-day in `briefing_cache`, keyed by `(date, tz)`
- AI feature toggle: `briefing` (defaults on)
- Prefetched in the background after midnight in user tz (`lib/briefingPrefetch.ts`)

### ◈ Weekly Digest
- Reading-pattern summary across the last 7 days
- Uses engagement signals from `article_prefs`
- AI feature toggle: `digest`

### ⚡ Quick capture (⌘K)
- One free-text input → routed to Task / Event / Note
- Routing model: `claude-haiku-4-5`
- Two-phase: classify → preview → user confirms → execute
- Routes:
  - **Task** → Google Tasks (with optional due date)
  - **Event** → Google Calendar (uses user timezone)
  - **Note** → appended to long-term memory under `## Notes` with date prefix
- AI feature toggle: `quick_capture`
- Rate-limited (1.5s between calls)

### ⚙ Preferences
- Five collapsible groups (sticky pill nav at the top): You / Connections & appearance / Email rules / Content sources / AI & memory
- State persists in localStorage (`prefs-groups-state`)
- Live quick-stats subtitles on each group header (counts + warnings)
- Save button at the bottom; on success, `clientCache.clear()` invalidates all derived data caches

---

## Preferences groups

### You
- **Role / Context**: free-form text. Injected into every AI call's system block.
- **Local Area**: select dropdown (`localFeedKey`). Drives local news feeds + weather home location.
- **Timezone**: select. Used for calendar event creation + briefing-date keying.
- **Priority Topics**: tag input. Biases AI emphasis.
- **Deprioritise Topics**: tag input. Pushes AI emphasis down.
- **Watchlist**: tag input. Cross-domain matching — highlights news items, OSINT items, aircraft callsigns, ship names.

### Connections & appearance
- **Accounts**: primary Gmail (current sign-in) + secondary Gmail (connect/remove via OAuth flow)
- **Apple Calendar / iCal Feed**: session-authenticated URL to subscribe to
- **Appearance / Theme**: nightwatch / amber / arctic / mission (persisted to `user_prefs.theme`)

### Email rules
- **VIP Senders**: tag input. Always-High override.
- **Muted Senders**: tag input. Always-Low override.

### Content sources
- **Tracked Locations**: inline editor (label + lat + lon, up to 10). Drives weather multi-location cards.
- **Markets Watchlist**: inline editor (`EXCHANGE:TICKER` + label, up to 30).
- **News Sources**: per-source enable/disable toggle list. Default: all 19 enabled. Disabling skips the fetch in `/api/news` entirely. Per-source items + token estimates shown.
- **OSINT Feeds**: inline editor with per-feed health dots, Test button (diagnoses with hint + alternative URLs), and a curated Suggestions panel.

### AI & memory
- **AI Controls**: master toggle + per-feature toggles for each Claude-calling route
- **Usage card**: today's spend / last-7 / last-30 in USD; per-route breakdown for today
- **Long-term Memory**: view / manually edit / clear the assistant's memory doc

---

## AI features (`lib/aiFeatures.ts`)

Every Claude call is gated by `isFeatureEnabled(feature, prefs)`. Master `aiEnabled` falsely-disabled overrides everything; per-feature toggle is opt-out (missing key = enabled).

| Feature | Route | Model | Notes |
|---|---|---|---|
| `chat` | `/api/chat` (streaming) | claude-opus-4-7 | Calendar/tasks chat panel. Prompt-cached system block (role + memory + recent docs + context). Background memory consolidation after each turn. |
| `news_chat` | `/api/news-chat` (streaming) | claude-opus-4-7 | Right-rail news chat. Caps articles at 40 for context. |
| `email_triage` | `/api/gmail` | claude-haiku-4-5 | Per-email priority + summary. Prompt-cached system block. Cached by `(id, account)` + prompt hash. |
| `email_actions` | `/api/gmail/actions` | claude-haiku-4-5 | Action item extraction from unread mail. |
| `email_draft` | `/api/gmail/draft` | claude-sonnet-4-6 | Reply drafts in the user's voice (Sent-folder samples). Review/edit inline; saves to Gmail Drafts, never sends. |
| `osint_triage` | `/api/osint/triage` | claude-haiku-4-5 | Per-OSINT-cluster priority + reason. Cached 14 days by prompt hash. |
| `doc_chat` | `/api/documents/chat` (streaming) | claude-opus-4-7 | Per-doc chat panel. Doc body in cacheable system block. |
| `newsletters` | `/api/newsletters` | claude-haiku-4-5 | Newsletter summarisation (Politico / DOW / Merge / ASF). Cached by message id + prompt hash. |
| `briefing` | `/api/briefing` | claude-opus-4-7 | Morning brief. Cached one-per-day by `(date, tz)`. |
| `digest` | `/api/digest` | claude-opus-4-7 | Weekly digest of reading patterns. |
| `threads` | `/api/threads` | claude-opus-4-7 | Cross-article narrative extraction. Caps articles at 40. |
| `quick_capture` | `/api/quick-capture` | claude-haiku-4-5 | Free-text → Task/Event/Note routing. Rate-limited 1.5s. |
| `memory` | background, via `lib/userMemory.updateMemoryFromChat` | claude-haiku-4-5 | Memory consolidation after chat turns. Debounced ~5 min between updates (pending exchanges queue). |

**Anthropic usage logging**: every call writes to `anthropic_usage` (route, model, input_tokens, output_tokens, cache_creation, cache_read, micros, created_at) via `lib/anthropicLog.ts`. Fire-and-forget so a DB hiccup never breaks the user response.

**Per-model rates** (micro-USD per token): kept in `lib/aiFeatures.ts`. Update when Anthropic changes pricing.

---

## Cross-cutting features

### Watchlist (cross-domain)
Single `user_prefs.watchlist` string array drives all of:
- News card highlighting (orange tint + ⚑ Watch chip)
- OSINT cluster highlighting (same treatment)
- OSINT triage prompt input (Claude considers these terms when scoring relevance)
- Aircraft map: callsign matches render as orange ⚑ markers
- Maritime map: ship name matches render as orange ⚑ markers
- Newsletter prioritisation
- News chat / threads / briefing prompt context

### Save-to-Docs
▤ button appears on every capture-able surface. All call `POST /api/documents` with:
- A composed markdown body (source-specific template)
- Auto-applied tags (`news` / `email` / `osint` / `tracking action-item`)
- A `link` backlink (`type: article|email|event|doc`, `id`, `title`) recorded in `document_links`

Sources:
- News card → tags `["news", item.category]`
- Email card → tag `["email"]`, link `type: email`
- OSINT cluster → tags `["osint", feedKind]`, link `type: article`
- Action item → tags `["tracking", "action-item"]`, link `type: email`. Body has interactive `## Status` task list.

### Long-term memory
- Single markdown doc stored in `user_memory.content`
- Updated in background after chat turns (debounced ~5 min). Pending exchanges queue persists across runs.
- Loaded into the chat system block on every turn
- Quick-capture notes appended under a `## Notes` heading with date prefix
- Editable / clearable from Preferences → AI & memory

### Recent docs as chat context
`getRecentDocsForContext(5)` returns the 5 most-recently-updated docs (archived excluded), 800 chars each, joined into the chat's cacheable system block. Lets the assistant cite the user's own notes.

### Surface state ("What changed since I last looked")
- `surface_state` table records per-surface `last_seen_at` timestamps
- News tab: stale articles (older than `last_seen_at`) render at 50% opacity, mouse-over restores
- Background updates last-seen on tab focus

### Theme system
- Four themes: nightwatch (default), amber, arctic, mission
- `components/ThemeApplicator.tsx` applies CSS custom properties at runtime
- Persisted to `user_prefs.theme`

### Auto-suggested VIPs
- `lib/replySignals.ts` analyses Gmail Sent folder for senders the user replies to often
- Stored in `vip_suggestions_cache`
- Surfaced as dismissible "Add as VIP?" chips on the Email tab

---

## Client-side caches (`lib/clientCache.ts`)

In-memory cache with stale-while-revalidate `peek()`.

| Key | TTL | Wiped on |
|---|---|---|
| `news:items` | 15 min | `clientCache.clear()` from prefs save |
| `newsletters:items` | 30 min | same |
| `calendar:events` | 15 min | same |
| `email:list` | 10 min | same |
| `digest:current` | 30 min | same |

Master `clientCache.clear()` runs after any preferences save so VIP/mute/role/topics/etc. changes flow into derived views without waiting for TTL expiry.

---

## Server-side caches

| Cache | TTL | Purpose |
|---|---|---|
| `email_classification_cache` | 30 days | Email Claude classifications by id + prompt hash |
| `osint_triage_cache` | 14 days | OSINT Claude classifications |
| `newsletter_cache` | indefinite (overwrites on prompt-hash mismatch) | Newsletter summaries |
| `briefing_cache` | indefinite (one row per date+tz) | Morning Brief, one per day |
| `vip_suggestions_cache` | regenerated periodically | Suggested VIPs |
| `/api/osint/feed` per-feed Map | 5 min | RSS body cache; LRU-capped at 40 entries; overall 12s budget on Promise.race |
| `/api/osint/aircraft` module var | 60 s | OpenSky proxy cache, single bbox |
| `/api/markets/contracts` module var | indefinite (re-fetch on miss) | DOD RSS parse |
| `/api/weather/space` module var | 10 min | NOAA SWPC |

---

## API surface (current)

```
/api/auth/*                    NextAuth flow + secondary Gmail OAuth
/api/user-prefs                GET / POST — all prefs
/api/ai-usage                  GET — today / 7d / 30d spend summaries

/api/news                      GET — RSS aggregation + sourceStats (feeds the trend recorder)
/api/trends                    GET — week-over-week movers from signal_daily_counts (no AI)
/api/newsletters               GET / POST — summarised + dismissals
/api/newsletter-feedback       POST — open tracking signal
/api/article-feedback          POST — thumbs / open signal

/api/gmail                     GET — unread + triage
/api/gmail/actions             POST — extract action items
/api/gmail/draft               POST — drafted reply: generate (AI) / create Gmail draft (no AI)

/api/calendar                  GET — events
/api/calendar/ical             GET (token-auth) — .ics feed
/api/tasks                     GET / POST — Google Tasks

/api/chat                      POST (streaming) — calendar/tasks chat
/api/news-chat                 POST (streaming) — news chat
/api/threads                   POST — cross-article narrative
/api/briefing                  POST — Morning Brief
/api/digest                    POST — Weekly Digest
/api/quick-capture             POST — text → task/event/note

/api/documents                 GET / POST — list / create
/api/documents/[id]            GET / PATCH / DELETE
/api/documents/[id]/backlinks  GET
/api/documents/[id]/export     GET — single doc MD
/api/documents/[id]/versions   GET — list snapshots
/api/documents/[id]/versions/[vid]/restore  POST
/api/documents/[id]/chat       POST (streaming) — per-doc chat
/api/documents/bulk            POST — pin/unpin/tag/untag/archive/unarchive/delete
/api/documents/tags            GET / POST — list / rename / merge / delete
/api/documents/export          GET — zip of all docs

/api/files                     GET / POST — list+quota / multipart upload
/api/files/[id]                GET (download) / PATCH (metadata) / DELETE
/api/files/[id]/inline         GET — inline serve for preview

/api/osint/feed                GET — aggregated items + feeds + sourceStats
/api/osint/triage              POST — Claude triage on a batch
/api/osint/test-feed           POST — single-URL diagnostic
/api/osint/geocode             GET — Nominatim proxy
/api/osint/aircraft            GET — OpenSky proxy
/api/osint/ships               GET — AISStream snapshot

/api/markets/contracts         GET — DOD RSS parse
/api/weather/forecast          GET — NWS forecast
/api/weather/alerts            GET — NWS active alerts
/api/weather/space             GET — NOAA SWPC

/api/user-memory               GET / POST — long-term memory CRUD
/api/surface-state             GET / POST — last-seen tracking
/api/saved                     GET / POST / DELETE — bookmarks
/api/thread-history            GET / POST / DELETE
/api/meeting-prep              POST — auto-context for upcoming meetings
/api/diag                      GET — debugging endpoint
```

---

## Background tasks

- **Memory consolidation**: triggered after each chat turn via `lib/userMemory.updateMemoryFromChat`. Debounced ~5 min between actual model calls — interim exchanges queue in `user_memory.pending_exchanges`.
- **Briefing prefetch**: `lib/briefingPrefetch.ts` — triggers a Morning Brief generation on first request after local midnight in user tz so the user doesn't wait for the brief on first open.
- **Digest prefetch**: `lib/digestPrefetch.ts` — similar pattern, weekly.
- **AISStream WebSocket**: long-lived from `lib/aisStream.ts`. Initialised lazily on first `/api/osint/ships` call. Auto-resubscribes on bbox change.
- **Cache pruning**: every email/OSINT triage cache write also fires a best-effort `DELETE … WHERE cached_at < cutoff` to keep table size bounded.

---

## Environment variables

```
NEXTAUTH_URL                       Public URL of the app
NEXTAUTH_SECRET                    NextAuth secret (openssl rand -base64 32)
GOOGLE_CLIENT_ID                   Google OAuth client
GOOGLE_CLIENT_SECRET               Google OAuth secret
GMAIL_SECONDARY_REDIRECT_URI       Secondary-account callback URL
OWNER_EMAIL                        Allowlisted email — only this account can sign in
ANTHROPIC_API_KEY                  Claude API key
AISSTREAM_API_KEY                  (optional) — live ship tracking
DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD   Managed MySQL
```

---

## Behaviors that distinguish this app

A short list of design choices worth carrying to a sibling app:

1. **Single user, opinionated**: no multi-tenant logic. All prefs live in a single `user_prefs` row.
2. **Fail-open on AI**: every Claude route checks `isFeatureEnabled`. When off, the route falls back to a sensible non-AI behaviour (snippet instead of summary, empty actions, etc.) rather than 503-ing.
3. **Prompt-hash-driven cache invalidation**: every AI cache key includes a hash of the system prompt (which itself includes user context). Editing your role / topics / watchlist transparently invalidates everything that depended on them.
4. **Cross-domain watchlist**: one user-managed term list drives 6+ different surfaces' highlighting / triage. Add a term once, see effect everywhere.
5. **Capture buttons everywhere**: news cards, email cards, OSINT clusters, action items all carry the same ▤ "save to Docs" pattern with auto-tags and backlinks.
6. **Live quick-stats on Preferences group headers**: lets you skim Preferences and see what's configured without expanding any panel.
7. **AI Controls = real off switch**: master + per-feature toggles, with a live spend display tied to actual Claude usage. Not a marketing toggle.
8. **Soft-delete tier for docs**: ▢ Archive between active and 🗑 permanent delete. Archived docs hide from chat context but stay restorable.
9. **Save state to URL hash**: the Docs sidebar's view + sort + tag-filter + tag-mode all sync to the URL hash so a particular filter is shareable / bookmarkable.
10. **Version history with undoable restore**: snapshotting the current state BEFORE applying a restore is the key safety net. Pinned at 25 snapshots per doc; throttled to 5 min between snapshots.
