# FEATURES.md — DEAD's Dashboard parity spec

A complete inventory of the user-facing features in this web dashboard,
organized to support keeping a sibling application (mobile, desktop, etc.) at
parity. Each section gives the user-facing behavior, the data shapes and
endpoints behind it, and notes on caching / AI / external dependencies.
`CLAUDE.md` holds the rationale and history; this file describes the app as it
is now.

Last updated 2026-10-07 against the code on branch `claude/kind-cray-bbas25`.

---

## Stack

- **Frontend / SSR**: Next.js 15 (App Router), React 19, Tailwind CSS
- **Server**: custom `server.js` Next.js server (binds `process.env.PORT`); `build.js` / `start.js` wrap `next build` / the server
- **Database**: managed MySQL via `mysql2` (`lib/db.ts`) — 49 tables created on first connection, additive `COLUMN_MIGRATIONS` + `KEY_MIGRATIONS`
- **AI**: Anthropic SDK (`@anthropic-ai/sdk`); models in active use: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5` (per route — see AI features)
- **Auth**: NextAuth 5 + Google OAuth — owner (`OWNER_EMAIL`) plus a crew allowlist (`ALLOWED_EMAILS`)
- **Maps**: React-Leaflet 5; basemaps are keyless **Esri / OpenStreetMap chains** (`lib/basemaps.ts` — dark · satellite · street, every chain ends on `tile.openstreetmap.org`; CARTO was removed); `h3-js` for GPSJam hexes
- **Icons**: `lucide-react` (vocabulary in `lib/icons.tsx`; weather glyphs in `lib/weatherIcon.tsx`)
- **Push**: `web-push` (VAPID) + `public/sw.js` (push / notificationclick / periodicsync only — no fetch handler, no offline cache) + `public/manifest.webmanifest`
- **WebSocket**: `ws` for the server-side AISStream vessel bridge
- **Zip**: `jszip` for the docs export and the Files bulk zip
- **Dates**: `date-fns`; feeds: `rss-parser`
- **Tests**: `npm test` → `npx --yes vitest@^2 run` (vitest is deliberately NOT a dependency — esbuild cannot run on the host)

Deployment target: GoDaddy Node.js Hosting. Outbound network is HTTP/HTTPS (80/443) only plus the managed MySQL. The container is ephemeral — all state lives in MySQL. `.npmrc` has `omit=dev`, so the build toolchain (TypeScript, Tailwind, PostCSS) lives in `dependencies`.

---

## Authentication

- Google OAuth via NextAuth (`lib/auth.ts`); scopes cover Gmail, Calendar and Tasks. JWT session strategy; the Google access token is refreshed 5 min early inside the `jwt` callback.
- **Allowlist** (`lib/allowlist.ts`, pure, tested): `OWNER_EMAIL` is the admin; `ALLOWED_EMAILS` (comma-separated, case-insensitive, whitespace-tolerant) admits crew accounts. Checked in the `signIn` callback AND re-checked on **every JWT refresh**, so removing an address from the env ends that session at its next turn.
- **Owner vs crew**: the owner writes the shared `user_prefs` row (team config: tracking lists, feeds, Mission Profile, SITREP bases) and reads diag routes; crew get read-only team config plus their own personal overlay (`user_personal_prefs`, `PERSONAL_PREF_KEYS`: role, topics, watchlist, VIP/mute, dismissed suggestions, newsletter sources, disabled news sources, local area, theme, timezone + mode). Crew `POST /api/user-prefs` writes only the personal subset.
- **Per-user surfaces** (`user_email` keyed; pre-split rows with `''` are honoured as the owner's): `briefing_cache`, `user_memory`, `surface_state`, `app_ui_state`, `email_prefs`, `surface_opens`, `push_subscriptions`, `x_upload_tokens`. Family / Household are owner-only.
- **Shared, crew-maintained, attributed by email**: `sitrep_limfacs`, `warning_decisions`, `crew_state`.
- **Sign-in without client JS**: `components/GoogleSignInForm.tsx` is a Server Action in a plain `<form>`; re-auth prompts are plain `<a href="/login">` anchors. The login form passes `login_hint` from the `dead_primary_hint` cookie (`POST /api/auth/primary-hint`, httpOnly, 1 y) or `/login?hint=`; otherwise the Google chooser is forced (`select_account consent`).
- **Secondary Gmail**: hand-rolled OAuth in `app/api/auth/gmail-secondary/{start,callback}` (`lib/secondaryOAuth.ts`, `lib/secondaryAuth.ts`); encrypted token in the httpOnly `secondary_gmail` cookie (never the DB); scopes `gmail.modify` + `calendar.readonly`; a "second" account equal to the primary is refused. Per browser, not per user.
- **Capture bearer token**: `x_upload_tokens` stores only a SHA-256 hash (plaintext shown once via `/api/settings/x-token`); accepted as `Authorization: Bearer xcap_…` by `/api/osint/x-import`, `/api/capture/*` and `/api/alerts/check`.
- **Apple Calendar / iCal**: `/api/calendar/ical` — session-authenticated `.ics` of the next 90 days across all calendars.

## Database schema

All tables live in one managed MySQL instance. Creation is idempotent (`CREATE TABLE IF NOT EXISTS`); columns and primary keys evolve through `COLUMN_MIGRATIONS` / `KEY_MIGRATIONS` in `lib/db.ts` (checked against `information_schema`).

**Prefs and users**

| Table | Purpose |
|---|---|
| `user_prefs` | The shared team row (id=1) + the owner's personal values; dedicated columns for `sitrep_bases`, `family_profile`, `mission_profile`, `acled_email/password`, `dismissed_watch_suggestions`, `timezone_mode`, `osint_feeds` |
| `user_personal_prefs` | Per-crew-member personal overlay (`user_email` PK, prefs JSON) |
| `user_memory` | Long-term chat memory markdown + pending exchanges, per user |
| `surface_state` | Per-user, per-surface last-seen (`email · news · newsletters · osint · oe · family`) |
| `app_ui_state` | Per-user cross-device UI blob (`osint.dismissed`, `crisisMap.layers/view/aor/basemap`, `newsletter.quietDismissed`, `calendar.mailDatesDismissed`, `email.actionsDone/actionsAdded`) |
| `surface_opens` | Per-user open counts for SITREP bases / I&W boards / countries (palette boosts, attention gaps) |
| `push_subscriptions` | Web-push endpoints per user with each device's `seen_ids` watermark |
| `x_upload_tokens` | SHA-256 of the per-user capture bearer token |
| `trips` | TDY / travel trips (the active trip is the effective location; `tz` filled from Open-Meteo once) |
| `contacts` | Keep-in-touch roster with cadence and last-contacted |
| `saved_items` | Bookmarked news articles + newsletter bullets |
| `article_prefs` | Per-article thumbs + opens — news sort, digest, trends |
| `newsletter_prefs` | Per-normalized-subject opens — quiet-newsletter detection |
| `email_prefs` | Per-user per-email priority override + Keep flag + the model's call (90-day rolling) |

**Caches (model output and derived reads)**

| Table | Purpose |
|---|---|
| `email_classification_cache` | Per-email priority / summary / `why` / `dates`, prompt-hashed (30 d) |
| `email_action_cache` | Action items per message (14 d; empty lists cached too) |
| `newsletter_cache` | Summarised newsletter bullets by message id + prompt hash (7 d) |
| `osint_triage_cache` | Per-OSINT-item priority + reason (14 d) |
| `briefing_cache` | Morning Brief, PK `(date, user_email, tz)` |
| `news_overview_cache` | The day's curated must-reads (PK = date, owner-flavored) |
| `vip_suggestions_cache` | Reply-pattern VIP suggestions |
| `anthropic_usage` | Every model call: route, model, tokens, micros, `user_email` |
| `thread_sessions` / `threads` | Threads view sessions (article hash, `generations` cap) and their threads (`amc` column) |

**Docs and files**

| Table | Purpose |
|---|---|
| `documents` | Markdown docs: title, content, tags, aliases, `collection`, `doc_type`, `props`, pinned, archived |
| `document_versions` | Last 25 snapshots per doc (5-min throttle; forced before split/append) |
| `document_links` | Wiki-link edges with `relation` / `note` + external backlinks (article / email / event) |
| `files` | File repo blobs (LONGBLOB, 30 MB per file, 250 MB aggregate), optional `doc_id` |

**OSINT and browser capture**

| Table | Purpose |
|---|---|
| `x_items` | Imported X posts (post id PK; 14 d / newest 1000) |
| `captured_articles` | Reader-captured analysis articles (rolling) |
| `captured_events` | Captured LiveUAMap events (14 d / newest 1000) |
| `captured_notices` | Captured ministry notices, first source MOFCOM (180 d / newest 500) |
| `signal_daily_counts` | Trend layer: per-day term counts (180 d) |
| `signal_pair_daily` | Trend layer: watch×topic / region×topic co-occurrence (90 d) |
| `signal_seen` | Trend dedup ledger (14 d) |

**SITREP, I&W, posture and the trend series**

| Table | Purpose |
|---|---|
| `force_posture_daily` | Daily force-protection composite per watched entry |
| `sitrep_status_daily` | Worst LED per axis per base per UTC day (`infra` / `spectrum` nullable) |
| `sitrep_limfacs` | Commander-entered LIMFACs, shared per ICAO |
| `warning_daily` | Daily I&W rollup per problem (baseline = trailing mean; `mobility_count` day-peak); economy actors as `econ-<actor>` |
| `indicator_daily` | Per-indicator level per day with `live` |
| `warning_decisions` | I&W decision log, shared per problem, one-way scoring |
| `demand_horizon_daily` | The day's last demand outlook per COCOM, scored 7 days later |
| `sensor_daily` | Registered numeric series (`lib/sensorKeys.ts`: `pnt ransom mob tanker cpact fc taf notam rwyclose xwind limfac swx kev outage px`) |
| `chokepoint_transits_daily` | Distinct MMSI + minutes listened per chokepoint per day |

**Family, household, team**

| Table | Purpose |
|---|---|
| `family_deadlines` | Persisted school/household obligations (`due_source`, lifecycle state; LAPSED derived) |
| `family_person_brief` | Running brief per family member with the message ids it incorporated |
| `household_bills` | Bill sightings (message id PK) for cadence and the silence watch |
| `crew_state` | Crew counts per qualification (no names), shared |
| `crew_state_daily` | The day's last crew counts — availability series |

---

## The nine tabs

`components/layout/TabShell.tsx` — `glance · news · calendar · email · family · docs · osint · markets ("Economy") · weather`. Every tab except Family stays mounted (hidden) once opened; Family mounts only while open because its digest reads Gmail and calls the model. `TabShell` mirrors the active tab onto `<body data-tab>` and handles the window door-in events (`app:navigate`, `osint:set-pane`, `watch:focus`, `regional:select`, `docs:open`, `docs:search`, `family:focus`, `prefs:open`, `capture:open`, `brief:open`, `digest:open`, `assistant:open`, `track:open`, `docs:append`).

### 1. Glance

**Purpose**: the operational picture at a glance — what moved, what needs your hand, where demand is going, then the wider picture. Order on the tab: header → world clocks → Where you are → Morning Brief card → RIGHT NOW status row → OE delta → Needs you now → Demand horizon → Global Reach Watch → Posture moves → Breaking & critical → the two-column body.

- **World clocks** (`components/glance/WorldClocks.tsx`, `lib/worldClocks.ts` pure): Zulu always far-left, the rest west→east by current UTC offset; big digits, day-phase glyph + sky (`phaseForHour`), device zone bordered; add/remove zones per browser (`localStorage["glance.clocks"]`).
- **Where you are** (`WhereYouAre.tsx` ← `GET /api/weather/here`, 10-min cache per user): the effective location (active TDY › home), conditions now + today (Open-Meteo), the nearest tracked airfield within 300 km with its flight category, the TAF turn and the 30-h model hazard; a dead feed leaves a null, never implied clear.
- **Morning Brief card**: open by default (headline, Key developments ≤5, Suggested focus ≤4); folded = one line. Full brief / Digest buttons open the modals. Fold state `localStorage["glance.briefOpen.v2"]`.
- **Today / Tomorrow** directly under the brief, bucketed in the **effective zone** (`useEffectiveZone`); every time carries its zone label.
- **RIGHT NOW status row** (`StatusRow.tsx`): Posture · Bases · I&W · Spectrum · Demand · Alerts · Tasks · Family tiles, each with its own `useFeed` (`/api/warning`, `/api/spectrum`, `/api/demand-horizon`, `/api/alerts/check`, `/api/family/week`); colour is earned, UNKNOWN is its own tone; each tile deep-links (Posture → `postureTarget()` into the command board, Bases → SITREP, I&W → the driving board, Tasks → Calendar). Family tile is owner-only.
- **OE delta** (`OeDeltaCard.tsx` ← `GET /api/oe-delta`): net level change per subject (posture entries, SITREP LEDs, I&W boards, economy actors) since this user's last `oe` look, improvements first-class, `firstLook` when no look is recorded; plus the **attention gaps** line (`lib/attentionGaps.ts`: subjects that stepped up and you have not opened since).
- **Needs you now**: tasks due/overdue, asks from email, high-priority email ("Your actions", violet) above world state (weather / disasters / posture / OSINT).
- **Demand horizon** (`DemandHorizonCard.tsx` ← `GET /api/demand-horizon`, bounded 8 s → `pending`): rise / hold / fall per COCOM with signed drivers, confidence = independent sources, the **Crews** strip (`/api/team/crew`) and the **Verified** footer (scored past outlooks, `skill`).
- **Global Reach Watch**: NEO (State Dept ordered/authorized departure, recent Level-4), disasters, base weather hazards, and the three access degraders from the cached force-protection feed (conflict / GPS / airspace); category chips, ≥3 of a kind fold to a summary row; rows naming the declared hub / spokes / TDY get a violet `mine` chip; "track" buttons on rows naming an unwatched country.
- **Posture moves** (`GET /api/posture-moves`, 15-min cache, bounded): force movements read from the defense feeds + GDELT (`lib/postureMoves.ts`, pure) merged with the client's own reading.
- **Breaking & critical** leads with a "🧵 Rising threads" row (`/api/thread-history`, 2 d), then the curated-critical articles; **On your radar** metrics (new stories / priority email / OSINT signals) highlight rises since the last visit (`localStorage glance:radar:baseline`).
- **⇩ OE brief** in the header (see Top bar).

### 2. News

**Purpose**: synthesis first — what the day's reporting is about, then the articles.

- **Sources**: `lib/newsSources.ts` — 42 sources across overview · defense · strategic · domestic · space · cyber · local (local sets keyed by `localFeedKey`); per-source disable in Preferences. `GET /api/news` fetches enabled feeds in parallel, returns `{ items, sourceErrors, sourceStats }` and records the trend series.
- **Two views** (`NewsShell.tsx`): **Threads** (landing) and **Read**. Read stays hidden-mounted so the feed loads.
- **Threads** (`ThreadsView.tsx` ← `POST /api/threads`, Opus): cross-article narratives with trajectory (`lib/threadTrajectory.ts`: run length, 14-day sparkline, diff vs the previous session, AMC line, door chips to I&W boards / chokepoints). Day-cached by article hash (`thread_sessions.article_hash`), capped at `THREADS_MAX_GENERATIONS` = 3 model calls per day (`capped:true` serves the day's last read; ↻ Regenerate = `?refresh=1`). Runs only while the view is showing. **Moving rail** (7/14/30/60 d: sustained → rising → re-emerging → steady → fading) and **Label drawer** replace the old History panel (`/api/thread-history`). Thread actions: Ask (seeds the assistant), Save to Docs (PATCH the existing `Thread: LABEL` doc or create a `thread`-typed one), Follow (watchlist), doors.
- **Read view**: lanes (`lib/newsLanes.ts`) — depth / now (curated-critical) / everything else folded; category chips as a secondary filter; `TrendStrip` (grouped movers from `/api/trends`, a chip filters the lanes, ◆ = 90-day high, new term pairs); `NewsCard` with thread badge, ★ save, ▤ save to Docs, ⧉ append to a log, 👍/👎, **thesis** (`POST /api/news/thesis`, Haiku, 6-h cache). Curation (`POST /api/news/curated`, Sonnet, `news_overview_cache`) feeds the "now" lane and Glance.
- **Newsletter queue** (`NewsletterSection.tsx` ← `GET /api/newsletters`, Sonnet, cached by message id + prompt hash): only EARNED rows by default (watchlist hit › thread match › kept pin) with the reason chip; per-source counts; **Catch me up** (= digest) and **Clear queue**; `POST /api/newsletter-feedback` syncs hide/keep ids.
- **One assistant**: the floating assistant on a `news*` surface receives 40 articles with summaries, 30 newsletters and the threads block (`/api/chat` accepts `threads`). The old news chat route is gone; the `news_chat` feature key remains in the toggles for ledger history.
- Sort: `lib/articlePrefs.ts` `sortByPreference()` (thumbs, source affinity, watchlist). Stale articles (older than the `news` last-seen) render dimmed.

**Client caching**: `news:items` 15 min, `news:curated` 12 h, `news:tripNews`, `trends:movers` / `trends:pairs` 15 min, `newsletters:items` / `newsletters:sourcemeta` 30 min.

### 3. Calendar

**Purpose**: one agenda in the effective zone with everything that has a date joined to it. `components/calendar/CalendarTab.tsx` owns tasks, contacts, family dates, trips, dismissals and the mail-dates feed; `CalendarPanel` (left) and `KeepInTouchPanel` + `TasksPanel` (right rail, always visible).

- **Sources**: Google Calendar (`GET /api/calendar`; `POST/PATCH/DELETE /api/calendar/events`), Google Tasks (`/api/tasks` GET/POST/PATCH/DELETE), trips (`/api/trips`), contacts (`/api/contacts`, `/api/contacts/suggest`), family dates (`GET /api/family/dates`, owner-only, no model).
- **Don't miss** (`lib/calendarDontMiss.ts`, pure): ONE list across family deadlines (late / due today), tasks (late / today / 7 d) and keep-in-touch (never / overdue / due), sorted late → today → week; each row carries its own actions (✓ done, snooze, tomorrow, contacted, schedule a check-in).
- **Agenda**: starts today; family rows deduplicated at render (`dedupeFamilyDates`, 45-day horizon) as a dashed violet register; **TDY chips** on day headers inside a trip ("TDY · Amman — day 5 of 9"); every timed event shows its zone label and the device time in the tooltip when they differ.
- **Today strip**: zone + source (pinned / trip / device), TDY chip, up to 3 events, counts.
- **Dates in your mail** (`lib/mailDates.ts`, pure): the triage's Haiku call returns `dates` (≤3 per email, `when` only for an unambiguous calendar date, cached in `email_classification_cache.dates`); reads the Email tab's already-loaded mail from `clientCache.peek("gmail:emails")`. Actions: ＋ Event (`POST /api/gmail/convert` mode create, `plan.timeZone` = effective zone), ＋ Task, Open email, ✕ dismiss (UI state).
- **Keep in touch**: cadence per contact, due / overdue, suggestions from VIP + reply patterns.
- **Effective zone** (`lib/effectiveZone.ts`, pure; `GET /api/zone`): pinned › active trip › device › saved pref › default; `lib/zoneClient.ts` caches 10 min.
- **iCal**: `/api/calendar/ical` for Apple Calendar (Preferences → Connections).
- **Meeting prep**: `POST /api/meeting-prep` — recent mail from an event's attendees (Gmail only, 1-h cache, no model).

**Client caching**: `calendar:events` 15 min, `tasks:items` 5 min, `zone:effective` 10 min.

### 4. Email

**Purpose**: the sift. Unread mail across primary + optional secondary Gmail, grouped **High → Medium → Low**, triaged by Haiku, corrected by you.

- **Source**: `GET /api/gmail` → `{ emails: EmailMessage[], secondaryConnected }`; each message carries `priority`, `priorityModel` (the model's call after VIP/mute), `prioritySet`, `keep`, `why`, `whySource`, `summary`.
- **Triage**: Haiku classifies uncached emails (High/Medium/Low + summary + `why` + `dates`), cached in `email_classification_cache` by `(id, account)` + prompt hash (30 d). VIP / mute rules apply after the cache; the per-email override applies after those.
- **Groups and rows**: each group header has "✓ Mark N read"; chips carry counts plus a **⚑ Kept** filter; Low rows render compact and open on tap; checkbox selects, row opens. Keyboard: j/k · x · e · h · 1/2/3 · Enter/o · Esc (only while `body[data-tab="email"]`).
- **Per-email override + Keep** (`POST /api/gmail/prefs`, `email_prefs`): High / Medium / Low for this email, clear, or Always High / Always Low from this sender (`/api/user-prefs/append`). Keep holds at both ends — the client drops kept ids from bulk actions and `POST /api/gmail/mark-read` refuses them (`{ok, done, kept, failed}`; refused ids are toasted "left in place").
- **Why line**: VIP / mute / override name themselves; no model call reads "not triaged — AI off or the call failed".
- **Learning** (`lib/emailLearning.ts`, pure; `GET /api/gmail/rules`): "How priority is decided" strip (role, topic / VIP / muted counts, corrections in 30 d, what the model reads, Rules ⚙); sender-rule suggestions after ≥3 same-direction corrections in 30 d (domain rule at ≥3 addresses); the 15 most recent corrections ride into the classifier outside the prompt hash. Suggested VIPs from reply mining (`GET /api/gmail/vip-suggestions`, `lib/replySignals.ts`, 12-h cache).
- **Action items** (`POST /api/gmail/actions`, Sonnet): cached per message (`email_action_cache`, 14 d); + Task / ▤ Doc; ticked and added state persists cross-device in UI state.
- **Drafted replies** (`POST /api/gmail/draft`, Sonnet): in your voice from Sent samples; saved to Gmail Drafts, never sent.
- **Email → task / event** (`POST /api/gmail/convert`, Haiku plan → Google write with the signed-in account's token; errors carry Google's reason).
- **File under Family** (`POST /api/gmail/label`, `lib/familyLabels.ts`): applies a `Family/*` Gmail label (School · Activities · Bills · Medical · Travel · Admin) and, owner only, tracks each sender's domain in the roster.
- **Save-to-Docs** (▤) and **⧉ Log** (append to a running log) on every card; "you have N notes on this" via `GET /api/documents/backlinks`.
- **Secondary account**: `AddAccountButton` shows the primary beside the secondary; `?secondary=same` notice when the chooser returns the primary.

**Client caching**: `gmail:emails` 10 min; wiped on prefs save.

### 5. Family

**Purpose**: school and household mail reported as obligations with dates, not as messages. Owner-only; mounted only while open. Two panes: **School** and **Household**.

- **Roster is the query** (`lib/familyProfile.ts`, pure; `/api/family/roster`; `user_prefs.family_profile`): people + watched senders → `from:(…) newer_than:14d`; billers get a separate 90-day query. An empty roster reads nothing.
- **School digest** (`GET /api/family`, `lib/family.ts`, Sonnet, 15-min cache; past the cache the model runs only when the message id set changed — `?check=1` polls ids only): deadlines (`buried: true` when inside a newsletter), per-person **running briefs** (`family_person_brief`: previous brief + only NEW mail, `whatsNew` highlighted, stale on failure), events per person, household paragraph, proposals.
- **Needs you**: persisted deadlines (`family_deadlines`; LAPSED derived, undated never lapses), deduplicated at render (`dedupeDeadlines`), done / dismissed folded into one line; **Set date** (`PATCH /api/family {id, dueIso}` → `due_source='user'`, never overwritten by a re-extraction) offers the dates the email itself names (`lib/datesInText.ts`, explicit forms only); snoozes.
- **While you are away** (`lib/familyAway.ts`, pure): the trip you are on or the next one; `happened` vs `ahead`; copy-as-list text.
- **Never a guessed date**: relative phrases come back `needsConfirm`; `POST /api/family/event` refuses an unanchored `startISO` (422).
- **Household pane** (`GET /api/family/household`, `lib/household.ts`, Sonnet extracts FACTS only): bills with `amountDelta` (null below 3 prior samples), **silence watch** (needs 3 prior sightings, generous slack), cadence learned (`auto` → observed → forming), **documents** declared with `leadDays` defaults by type (passport 183, visa 90, licence/insurance 30), **account jeopardy** (deterministic phrases + suppressors, before the model), amount creep, expected documents. Degrades to the deterministic half when the model fails.
- **Proposals** (`lib/familyProposals.ts`): mentions and dated documents mined from mail already read (same call); Track → `PUT /api/family/discover`, Never → `DELETE ?key=`.
- **Sender discovery** (`POST /api/family/discover`, headers only via Gmail `format:"metadata"`; weekly auto-run when `autoDiscover`; `POST {label}` seeds from a Gmail label; `GET ?labels=1`).
- **Mark read** (`lib/familyMarkRead.ts`): after a SUCCESSFUL model pass only; undated-deadline sources, `needsConfirm` events and jeopardy hits stay unread; `FamilyProfile.markRead` switch.
- "New since your last visit" anchors on `surface_state.family`.
- Brief inputs: `GET /api/family/week` (the week ahead for the Morning Brief and the Glance tile).

### 6. Docs

**Purpose**: a markdown wiki with wiki-links, versions, synthesis tooling, running logs and a file repo.

#### Editor (`DocEditor.tsx`)
- Split-view preview, autosave, ⌘B / ⌘I / ⌘K link / ⌘[ wiki-link / ⌘F find-replace; slash commands `/h1 /h2 /h3 /quote /task /list /ol /code /hr /wiki /link /today /now /template`; TOC sidebar; task checkboxes flip the source; word count / read time.
- **Typed links** `[[Title | relation: note]]` (supports / contradicts / extends / defines / example-of / see-also, `lib/linkRelations.ts`) stored in `document_links.relation/note`; **aliases** (`≈ alias`, `documents.aliases`); **unlinked mentions** (`lib/docMentions.ts`) with ⇄ Link / Link all / dismiss; **backlinks with context**; **hover previews** (`/api/documents/titles` index).
- **✂ Split at headings** (`lib/composeDocs.ts splitAtHeadings`, force-snapshot first via `POST /api/documents/:id/versions`); **◉ Graph** (`/api/documents/graph?id=&depth=`, concentric rings, `lib/docGraph.ts`); **💬 Ask** per-doc chat (`POST /api/documents/chat`, Opus, streaming); 📜 History (25 snapshots, undoable restore); ⬇ MD; ▢ Archive; 🗑 Delete; type badge; ⚙ properties (`key:value`, click filters); collection picker; tags.
- **Thread timelines**: in a 🧵 doc the ordered list under "Trace" renders as a timeline (`lib/threadTrace.ts`).

#### Logs and Append-to
- A **log** is a `log`-typed doc of dated entries (`lib/docAppend.ts`: `appendEntry` appends at the END, `latestEntry` by date). `POST /api/documents/:id/append` snapshots first and records the source as a backlink; `GET /api/documents/logs` lists logs with their newest entry; `POST /api/documents` is idempotent by external link (`existing: true` unless `force`).
- **Append picker** (`components/AppendPicker.tsx`, opens on `docs:append`): your logs first (recents in `localStorage docs.appendRecents`), other docs, "New log"; entry editable; "⧉ Append to <last log>" one-tap. Doors: the **selection chip** (select ≥12 chars anywhere), article thesis, NewsCard ⧉, OSINT cluster ⧉, EmailCard ⧉ Log, assistant replies, ⌘K "Append to a log", quick capture's `append` kind.
- **Landing** (`LogsLanding.tsx`) replaces "No document selected"; sidebar has a 📓 Logs view.

#### Compose · Templates · Organization · Lexicon
- **⧉ Compose** (bulk bar): reorder, title page / ToC / link rewrite / metadata / footnotes → Save as doc (`synthesis`), Export .md, Export HTML notebook (self-contained, HTML-escaped).
- **Templates**: docs tagged `template`; New ▾ lists them, saves the open doc as one, seeds the starter set (`lib/docTemplates.ts`: theorist card, debate, thread, comps answer, trip report, decision log); `/template` inserts at the cursor.
- **Collections** (`documents.collection`, sidebar groups once any exist; bulk ▤ Move), **doc types** (`lib/docTypes.ts`: note / theorist / debate / thread / case / term / synthesis / log), **properties** (`props` JSON; search grammar `course:600`, `type:theorist`, rest → FULLTEXT via `lib/docSearch.ts`).
- **≔ Lexicon** (`/api/documents/lexicon`): term docs as a glossary with owner and link count.

#### Sidebar
- Search (FULLTEXT ≥3 chars), smart views **All · 📓 Logs · Pinned · Recent (7d) · Stale (30d+) · Untagged · From email · From OSINT · From news · Action items · Archived**, sort Recent / Title / Longest, tag chips with Any/All, # Manage tags (`/api/documents/tags`), bulk bar (pin / tag / archive / move / delete / compose via `POST /api/documents/bulk`), ⬇ Export all (`/api/documents/export` zip), recent-docs strip, URL hash state.

#### Files (`FilesPanel.tsx`)
- The whole pane is the drop zone (folders too); per-file upload queue with retry; 30 MB per file, 250 MB aggregate (usage bar); preview images / PDFs (CSP allows `'self'` frames) / text; checkboxes + bulk bar (tag / untag / attach to the open doc / **⇩ .zip** via `GET /api/files/zip?ids=` / delete via `POST /api/files/bulk`); ⇩ on every row; auto-attach to the open doc.

### 7. OSINT

**Purpose**: the command board. `OSINTTab.tsx` panes: **Commands** (landing) · **Feeds** · **Sources**. Legacy pane ids (`watch`, `regional`, `crisis`, `sitrep`, `iw`, `ground`) land on Commands; All / Social / Telegram / News are a subfilter inside Feeds.

#### Commands (`CommandBoard.tsx`, `lib/commandBoard.ts` + `lib/primer.ts` pure; `GET /api/commands?since=`)
One scrolling page of lists; every row is a door into **the room**.
- **Where to look first** — the deterministic primer (tiers: posture escalated to RED today › board at ALERT › airfield worse than yesterday with a RED LED › board at WARNING and deteriorating › demand RISE against thin crews › convergence breadth ≥3 › I&W calls due; cap 6; each item carries a door), the footer naming quiet commands and dead sources; **✦ Read (AI)** on tap only (`POST /api/commands/read`, Sonnet, 15-min cache). `ReactivationCard` ("Back on the board") sits under it.
- **My airfields** — hub · spokes · ★ fields with five LEDs each; ＋ Track…, ✕ untrack, **hub / spoke switch** (`setOwnForceRole`, one hub; `POST /api/track {op:"role"}`), the undo strip (20 s).
- **Combatant commands** — one row per AOR (I&W · posture · bases · demand 7 d · events · Δ since look · WHY), ★ first then worst, quiet commands folded into one line; a row drills in place to its boards and countries (★ first, posture, chronicity, driver, pinned field's LEDs, Δ, events, ＋ Track in <country>, ✕).
- **Airfields by command** (`CommandAirfields.tsx`) — every tracked field, hide-green toggle.
- **The room** (`RoomDrawer.tsx`, `lib/room.ts` pure): a drawer from the right (full-screen sheet on a phone; **⇥ pin** docks it as a right column, `localStorage commands.roomPinned`); **country** page tabs Overview · Incidents · News · Civil · Health · Spectrum · Airfields (`CountryRoom.tsx` ← `GET /api/ground-truth?country=` + `POST /api/ground-truth/sitrep`); **airfield** page tabs SITREP · Weather · Ops · NOTAMs · Threats · Infrastructure · Spectrum · History (`SitrepPanel single`); **board** page (`WarningBoard only=[id]`); ‹ › walk the command's countries / fields / boards; Esc closes. The open room is in the URL as **`?room=country:Germany` / `field:ETAR` / `board:mp-iran`** so ⌘K, primer doors, Glance tiles and pasted links open the same thing. Opening a base / board / country records an open (`POST /api/opens`).
- **The picture** — the Crisis map and **⚠ Significant events** (disasters + departure advisories + top conflict points) with lenses *near my airfields* (≤600 km) and *new since look*; the map follows whatever is open.
- Latency: the route answers 202 `pending` within 8 s on a cold assembly; the board polls (≤12 × 8 s); a thrown assembly returns a stub with `error` for 60 s.
- ★ writes `MissionProfile.mustTrack` (`PATCH /api/mission-profile`); adds / removes / roles go through `/api/track`; the board reloads on `tracking:changed`. Crew see rows read-only.

#### Crisis map (`CrisisMap.tsx`, inside Commands)
- **Basemap** (`lib/basemaps.ts`): dark (Esri dark canvas → OSM-darkened) · satellite (Esri imagery + reference labels → Esri dark → OSM) · street (Esri street → OSM); a provider that fails `TILE_FAIL_LIMIT` tiles without ever loading one is judged refusing and the chain advances with a `basemap:` badge; pick persisted in `crisisMap.basemap` UI state.
- **Layers** (grouped popover, counts, persisted): Threats — Disasters, Hub wx, Tropical + Cone, Radar (RainViewer, off), NEO, Conflict (UCDP, ReliefWeb fallback), ACLED, GPS (GPSJam H3), Outages (IODA), Launches (Launch Library 2); Anticipatory — INFORM Risk (World Bank Data360, off); Nodes — Hubs, CRF, Gateways, Tracked, Forces; Reach — Rings (airframe, Max/Light payload, planning-grade), AR, Bridges; Movement — Mil air (keyless ADS-B, mobility-only / tanker filters), Vessels (AISStream, ~300 km around home + the chokepoint boxes), Overflight (DAIP FIR NOTAMs for watched countries); Display — Labels.
- **Toolbar**: View presets, AOR chips (drive dots + force rail + events list together), ⚙ Layers, Legend, search, Fit / ↻ / Full, **Demand read** (`GET /api/crisis-read`, Sonnet, 10-min cache, on tap, not feature-gated).
- **Node popups**: flight-category ring (`/api/airfield-weather`), runway capability (`/api/airfield-capability`), lift line, Track buttons; Force posture popups carry the AI force read (`GET /api/force-read`, Sonnet, `chat` gate).
- **Honesty**: `ErrorBoundary` names a render failure; a refused session raises a red "signed out" badge; a source-down strip names every dead feed; `GET /api/osint/map-diag` (owner) fetches every host from production.

#### SITREP (`SitrepPanel.tsx`, `lib/sitrep.ts` server, `lib/sitrepSignals.ts` pure)
- Bases: `user_prefs.sitrep_bases` (cap `SITREP_MAX` = 6, hub first then ★), managed by `/api/sitrep/bases` (owner) and kept in step with ★ taps.
- `GET /api/sitrep?icao=` (10-min cache): METAR + decoded + 24-h **TAF category bar**, NWS alerts, Open-Meteo, DAIP NOTAMs bucketed (runway / navaid / hours / airspace / fuel / bird), ARTCC centre NOTAMs, runway capability, runway winds / crosswind, astro (`lib/astro.ts`), force-protection composite, disasters ≤500 km, impact-filtered GDELT news, **Infrastructure** (IODA drop %, FAA NAS, USGS gauges; power / comms news-derived only), **Spectrum** (GPSJam cell, RAIM NOTAMs, space-weather impacts, KEV × declared vendors), **closure-window timeline** (NOTAM schedules expanded per occurrence, indeterminate = dashed), **tempo** (`lib/baseTempo.ts`), **mission impact** (`lib/limfac.ts`: FMC / PMC / NMC per function, LIMFAC register, CCIR; chronicity + time-to-resolve), five LEDs (WX / OPS / THREAT / INFRA / SPC), last-7-days strip (`sitrep_status_daily`).
- `GET /api/sitrep/summary` (bounded 8 s): per-base LED rollups for the strip, Glance and the brief. `POST /api/sitrep/read`: the Commander's Read (Haiku, `chat` gate, 15-min cache). `/api/sitrep/limfac` GET / POST / DELETE: shared commander-entered LIMFACs. **⇩ Export HTML** (`lib/sitrepExport.ts`): one self-contained, script-free, escaped snapshot. ⧉ Save to Docs.

#### I&W (`WarningBoard.tsx`, `lib/warning.ts` + `lib/warningTaxonomy.ts` + `lib/warningRules.ts` pure)
- One board per primary AOI (`problemFromSeed`; CENTCOM · Iran legacy ids kept) plus economy actors; indicators carry falsifier + provenance + decision linkage; every board gets `pnt_denial` + `cyber_pressure`, `space_activity` where a space power is in the AOI; the chokepoint indicator is the graded chokepoint read.
- Score = anomaly against the board's own baseline (`warning_daily`), learning mode caps at WATCH, red only at ALERT, drivers always shown; sensors (`lib/warningSensors.ts`, `lib/spectrumSensors.ts`) bounded with `sensorHealth`; own-source corroboration (X captures, newsletters, OSINT feeds, captured articles) — own-source-only caps at WATCH.
- `GET /api/warning` (bounded 12 s): assessments with 14-cell history, run, **lead indicators** (`lib/leadIndicators.ts`).
- **Decision log** (`DecisionLog.tsx`, `/api/warning/decision`): call + expectation + horizon, reopened at the horizon, scored once (right / wrong / ambiguous), tally below `MIN_SCORED_FOR_RATE`; **calibration** (`lib/indicatorCalibration.ts`): downweight / forming / earning proposals per indicator — nothing re-weights automatically.

#### Feeds
- RSS / Atom / Telegram bridges aggregated and clustered (`GET /api/osint/feed`, 5-min per-feed cache, 40-entry LRU, 12-s budget), merged with X captures, captured events ("🗺 region") and articles; time window All / 4h / 24h / 7d; watchlist ⚑; AI triage (`POST /api/osint/triage`, Haiku, 14-d cache; only while the tab is active and visible); situation line (`POST /api/osint/situation`, Haiku); ▤ / ⧉ per cluster; "AOR contacts" strip from `/api/osint/aircraft` (OpenSky) and `/api/osint/ships`. The feed loads ONCE at app mount so the brief sees the deterministic signals; triage and polling are active-gated.

#### Sources (`SourcesPane.tsx`)
- **Watchlist suggestions** (`/api/osint/watchlist-suggestions`): add (new / rising movers) and drop (watch terms that stopped matching), each with evidence, dismissal permanent.
- Feed editor (`GET/PUT /api/osint/feeds`, owner writes), health dots, Test (`POST /api/osint/test-feed`), suggested feeds (`lib/osintSuggestions.ts`, AO-aware groups).
- **Browser capture** (`XImportCard.tsx`, `CaptureStatusCard.tsx`): X posts (bookmarklet `tools/x-capture-bookmarklet.js` or the `tools/x-auto-capture/` MV3 extension on a schedule → `POST /api/osint/x-import`), analysis articles (`article.js` → `/api/capture/article`), LiveUAMap events (`liveuamap.js` → `/api/capture/events`), MOFCOM notices (`mofcom.js` → `/api/capture/notices`); pure validators in `lib/xImport.ts`, `lib/articleCapture.ts`, `lib/eventCapture.ts`, `lib/noticeCapture.ts`; the bearer token panel (`/api/settings/x-token`). No server-side X access of any kind.

#### Track (the one command)
- `components/TrackPicker.tsx` (opens on `track:open`): search → candidate (`GET /api/track?q=`; places geocoded client-side via `/api/osint/geocode`) → roles (posture · METAR · SITREP · ★) → one `POST /api/track {op:"track"|"restore"|"role"}` → change lines + **Undo** (the exact inverse request). `lib/trackingRegistry.ts` (pure) folds `forceLocations` / `countriesOfInterest` / `metarStations` / `sitrepBases` / `mustTrack` / `trackedLocations` into one registry; removing an AUTO row records its exclusion; a full list is a warning, never a silent drop. Buttons on every map popup, board row, Weather card and ⌘K.

### 8. Economy (`MarketsTab.tsx`, label "Economy")

**Purpose**: understand and predict when the countries or AORs you track are engaging in economic warfare. Order: Economic Warfare Read → actor board → chokepoints → energy strip → U.S. regulatory actions → sanctions / overflight / basing news.

- **Economic Warfare Read** (`EconomicAccessPanel.tsx` ← `POST /api/markets/brief`, Sonnet, `markets_brief` gate, 3-h day cache): per actor a level call (dissent from the board stated), falsifier, decision linkage; generates in the background (202 `pending`, polls every 6 s), waits for `econ:board-ready` before its first run; truncated replies are salvaged (`lib/aiJson.ts`); a deterministic `fallbackBrief` is flagged `fallback: true` and retried once.
- **Actor board** (`EconomicWarfareBoard.tsx` ← `GET /api/markets/economic-warfare`, 10-min cache, bounded 8 s → `pending`; `lib/economicWarfare.ts` pure, `lib/economicWarfareAssess.ts` server): one tile per actor (`validateActorName` — a name is an actor only when the app can PLACE it; skipped names say why), level / anomaly / trajectory against `warning_daily econ-<actor>`, instrument chips ⚓ ⛽ ⊘ ⇄ ¤ ✈ ⌁ lit only on a graded signal, "⇐ U.S." counter-pressure, "day N of 14" learning, driver line; **⚙ Actors editor** (exclude / add, `MissionProfile.economy`, `PATCH /api/mission-profile { economy }`).
- **Coercion board**: one author per headline (`movesForAll`, `pickAuthor`), act › threat › analysis › reversal modality, evidence, corroboration, affects, falsifier; actor + instrument filters.
- **Timeline** (`lib/economicTimeline.ts`): 30 days, lanes U.S. · EU/UK · one per actor · strait incident · Brent ≥3 %; hover detail, click pins and opens the row; `retaliation` / `counter` sequences.
- **Leverage map** (`lib/leverage.ts`): curated, dated, folded, never coloured.
- **Chokepoints** (`ChokepointBoard.tsx` ← `GET /api/markets/chokepoints`, `lib/chokepointReads.ts` 15-min): eight tiles (hormuz · babelmandeb · suez · bosphorus · malacca · taiwan · panama · russia-ovf) with the graded read + **AIS transit** chip (`lib/chokepointAis.ts` / `lib/chokepointTransit.ts`: distinct MMSI per observed hour vs own baseline — unconfigured / unknown / learning / normal / suppressed / elevated; needs `AISSTREAM_API_KEY`) and one detail panel.
- **Energy** (`GET /api/markets/energy`, `lib/energyPrices.ts`, Yahoo Finance keyless, Stooq fallback, 15-min cache, `range=1mo` series, baseline vs 90-day mean after 20 days).
- **U.S. regulatory actions** (`RegulatoryBoard.tsx` ← `GET /api/markets/regulatory`, Federal Register, 6-h cache, `lib/regulatorySignals.ts` pure): class by agency, instrument, countries, ⚑ on the watch.
- **EU / UK lists** (`lib/foreignSanctions.ts`, streamed CSV, 24-h cache): new-listing waves feed counter-pressure, the coercion board and the timeline; `?diag=1` on the economic-warfare route.
- **MOFCOM notices** (captured) credited to China as reported acts (Chinese vocabulary first).

**Client caching**: `markets:brief:v2` 15 min.

### 9. Weather (`WeatherTab.tsx`)

Order: header (counts, ＋ Place / ＋ Airfield / manage / Refresh) → **sources strip** (`WeatherSources.tsx`: one chip per keyless feed with ok / down / none-here) → **Places** (TDY · home · civil points; ✕ / ＋ through the Track command) → **My airfields by combatant command** (`AirfieldsByCommand.tsx`) → **Threats & disasters by command** (`ThreatBoard.tsx`) → the map → space weather.

- **Place cards** (`LocationCard.tsx`): NWS forecast + alerts (`/api/weather/forecast`, `/api/weather/alerts`, 15 / 3-min cache) fused with Open-Meteo (`/api/weather/current`, 15-min; `daily[7]` so OCONUS cards never go blank); lucide condition glyphs; the alert badge expands in place; source line on every card.
- **Airfield cards**: decoded METAR, the 24-h TAF category bar, worst category ahead with its window, the 30-h hazard, **crosswind** for the favoured runway end (`/api/weather/metar?xwind=1`), a SITREP door, map, ✕; UNKNOWN says why. Grouped per COCOM with LED + "worst: ICAO — why", quiet commands one line, hide-green.
- **Threats** (`GET /api/weather/threats`, 3-min cache, shared with Glance and the brief): alerts / tropical / hazards / disasters as rows under each COCOM, worst first, `near …` + source; `SpaceWxThreatRow` only at a scale ≥3.
- **Map**: Windy.com embed (Wind / Rain / Temp / Clouds / Pressure) that follows the selected place or airfield.
- **Space weather** (`SpaceWeatherCard.tsx` ← `GET /api/weather/space`, 10-min; `lib/spaceWeatherOps.ts` pure): ONE sentence (`spaceWxSentence`) + four impact LEDs (HF / GPS / SATCOM / radiation, read against the Mission Profile `polarRoutes` declaration); Kp · G/R/S · history fold; the cadence line from `sensor_daily swx:`.
- `MetarPanel.tsx` — quick METAR strip.

---

## Top bar / global

### ◆ Morning Brief (`BriefingModal.tsx`, `POST /api/briefing`, Opus)
- Daily synthesis of news, newsletters, OSINT signals, calendar, tasks, force posture (with direction: ESCALATED / EASED), rising threads, family week, travel weather (Open-Meteo + Nominatim).
- **Zone**: `prefs.timezoneMode` `auto` (device `tz` wins) or `pinned`; the active trip is resolved before the cache check. Cache PK `(date, user_email, tz)`; `generatedAtMs` / `generatedTz` baked in.
- **Inputs are gated**: `TabShell` prefetches only after calendar / newsletters / OSINT readiness (25-s grace) plus a 1.5-s settle; the modal waits up to 20 s for articles. A brief with zero newsletters / OSINT / articles regenerates when they arrive, capped at `MAX_GENERATIONS` = 3 per day (`lib/briefingUpgrade.ts`); a sectionless brief built from articles is refused (502 "incomplete") rather than cached.
- Base SITREP LEDs and "Your day" are fetched live at open, never baked in. `lib/briefingPrefetch.ts` warms it after local midnight. Client key `briefing:result` 15 min.

### ◈ Weekly Digest (`GET /api/digest`, Sonnet, `digest` gate)
- Reading-pattern summary from `article_prefs`, 24-h server TTL, `lib/digestPrefetch.ts`; client key `digest:result:v2` 30 min. "Catch me up" on the newsletter queue opens it.

### ⌕ ⌘K command palette (`components/CommandPalette.tsx`, `lib/commandPalette.ts` pure)
- Every surface by name: tabs, OSINT panes, SITREP bases, I&W boards, countries, family members, docs, Preferences sections; actions `act:brief · act:digest · act:capture · act:assistant · act:alerts · act:oebrief · act:track · act:append`; "Search docs for …" fallback; **"You open these"** group from `/api/opens` (recency-decayed boosts capped below the smallest token score). Entity lists are fetched on first open, refreshed after 5 min, never on page load.
- **Quick capture** lives inside it (`QuickCaptureModal.tsx`, `POST /api/quick-capture`, Haiku): free text → `task` (Google Tasks) · `event` (Calendar, effective zone) · `note` (memory `## Notes`) · `append` (a named log via `executePlan`); classify → preview → confirm.

### ⚙ Preferences (`PreferencesDrawer.tsx`)
- Six sections, one at a time, from a desktop left rail or the phone pill row; `?prefs=<key>` deep link (`history.replaceState`), `localStorage["prefs-active-group"]`; live subtitles per section. The drawer re-reads the row on every open; Save clears `clientCache`.
- **Mission Profile**: `TrackingPanel` (What you track: summary strip, ＋ Track…, airfields with role chips / hub / spoke / AUTO / ✕, countries, civil places, **Excluded from Apply** with Restore), `MissionProfileEditor`, `CrewStateEditor` (counts per qual, stale after 24 h).
- **You**: Role / Context, Home Location (`HomeLocationEditor`, distinct from the hub), Local News Region, Timezone (Auto / Pin), Priority Topics, Deprioritise Topics, Watchlist — Keyword Alerts, **Alerts on this device** (`PushSetupCard`).
- **Connections & appearance**: Accounts (primary + secondary Gmail), Apple Calendar / iCal Feed, Appearance (nightwatch / amber / arctic / mission, `ThemeApplicator.tsx`).
- **Email rules**: Always High — VIP Senders, Always Low — Muted Senders.
- **Content sources**: TDY / Travel (`TripsEditor`), Tracked Locations (civil places), Markets Watchlist, News Sources (per-source toggles + token estimates), Newsletter Sources, OSINT Feeds (health dots, Test, suggestions), ACLED Strikes (`/api/settings/acled`, env override read-only).
- **AI & memory**: AI Controls (master + per-feature toggles), Today's spend / 7 d / 30 d with per-route and per-user breakdown (`GET /api/ai-usage`), Long-term Memory (`/api/user-memory` view / edit / clear).

### Floating assistant (`components/chat/FloatingAssistant.tsx`, `POST /api/chat`, Opus, streaming)
- Scheduler + ops analyst. Cacheable system block: role, memory, recent docs (5 × 800 chars, archived excluded), the Mission Profile summary line, correction lines; per-turn dynamic block carries the **OE context** (`lib/oeContext.ts` + `lib/oeContextFormat.ts`: posture worst-first, SITREP LEDs, I&W boards, alerts, what changed since your look, calls due — capped at `OE_CONTEXT_MAX_CHARS`, UNKNOWN stated never dropped, each section naming its surface) served from a 5-min snapshot with a 2.5-s bounded wait; `surface` from `<body data-tab>`; on News surfaces the articles / newsletters / threads. Action blocks `[ADD_EVENT:…] [MOVE_EVENT:…] [EDIT_EVENT:…] [DELETE_EVENT:…] [ADD_TASK:…]`. Memory consolidation runs in the background (`lib/userMemory.ts`, Haiku, `memory` gate, debounced). Thread in `localStorage assistant:thread`.

### Track picker · Append picker · Selection chip · Toasts
- `TrackPicker.tsx` (`track:open`), `AppendPicker.tsx` (`docs:append`), `SelectionChip.tsx` (floating "⧉ Append to…" on any ≥12-char selection outside inputs), `ToastHost.tsx` (`lib/feedback.ts toast`), `SessionExpiredBanner.tsx` (plain link to `/login?hint=`), `ErrorBoundary.tsx`.

### Installable app + web push
- `public/manifest.webmanifest`, icons, `app/layout.tsx` metadata; `public/sw.js` handles push + notificationclick + periodicsync ONLY.
- `/api/push/subscribe` GET (configured + VAPID public key + device count) / POST (this browser's subscription, optional test push) / DELETE. Per user.
- **Dispatch has no cron**: every `/api/alerts/check` hit runs `dispatchPush()` (`DISPATCH_MIN_GAP` 4 min) comparing `computeAlerts()` (`lib/alerts.ts`, 5-min cache; kinds `force · weather · neo · warning · spectrum`, stable ids) against each device's `seen_ids` (`lib/pushSelect.ts`, pure). Pollers: the capture extension (default 15 min), `AlertHeartbeat.tsx` (10-min, visible tabs, only when the account has a device), an installed PWA's `periodicsync`. The same hit runs the **daily heartbeat** (`lib/dailyHeartbeat.ts`, once per 6 h per process: demand horizon, SITREPs, energy, spectrum, crew snapshot, energy backfill) so the series accrue on days nobody opens the dashboard.

### ⇩ OE brief export (`lib/oeBriefExport.ts` + `lib/oeBriefViewer.ts`, `GET /api/oe-brief`)
- One self-contained, zero-JS HTML page rendered in the browser from the assistant's `OeSnapshot` (waited up to 12 s) + open decisions + the mission summary: masthead "SNAPSHOT AS OF …Z — NOT LIVE", BLUF chips, what changed, alerts by family, demand table + skill, posture table, SITREP LEDs, I&W boards, open calls. Opens in a tab with Download / Print / Close; exporting does not bump the `oe` last-seen.

---

## Mission Profile (the configuration spine)

**Preferences → Mission Profile.** Declare WHAT you command; the app derives WHAT TO TRACK. Pure model + derivation in `lib/missionProfile.ts` (tested); `lib/missionApplyPlan.ts` (`planApply`, pure); server `lib/missionProfileApply.ts`; `/api/mission-profile` GET · PUT (declaration) · POST (apply) · PATCH (`mustTrack` / `economy`), owner-gated writes.

- **Declaration**: hub + spoke airfields (stored RESOLVED via `/api/airfields/resolve`), theaters, named AOIs (countries, primary / watch, I&W toggle, suggested chokepoints), `spectrum` (`polarRoutes` default false, `satcom`, `edgeVendors`, `spaceActivity`), **must-tracks** (`{ aors, countries, icaos }` — ★ on the command board and the `MustTrackEditor`; ★ ORDERS AND PINS, never adds tracking), `economy` (actor exclude / add). The declaration **autosaves** (debounced PUT).
- **Derivation — one channel per concept**: airfields → `forceLocations` + `metarStations` + SITREP candidates (hub › ★ › spokes › AOI picks, cap 6); AOI countries → `countriesOfInterest`; chokepoints → watchlist terms; primary AOIs → I&W boards (`lib/warningProblems.ts`; `ProblemGeo.aor` declared; `ownHubs` lead a board's hubs). `trackedLocations` stays civil-only.
- **Apply = preview → confirm**: `applyMissionProfile(raw, picks, { dryRun })` returns the diff (adds / drops per list, SITREP from → to, drifted, empty); derived rows carry `mp-*` ids (AUTO badges); manual rows win natural-key collisions; `materializedIds` is exactly what was written.
- **Deletions stick**: removing an AUTO row anywhere (the Track picker, the board, the Weather tab) records its exclusion; Restore lives under "Excluded from Apply".
- **Hub / spoke role switch** (`setOwnForceRole`, pure): one hub — promoting demotes the old hub to a spoke; assigning a role lifts the field's exclusions; `undo` is the ordered inverse. Server `applyOwnForceOps` ensures an own-force field is tracked.
- **The registry** (`lib/trackingRegistry.ts`): one `AirfieldRecord` per ICAO (roles, hub / spoke, AUTO) and one `CountryRecord` per country, normalised by `lib/countryNames.ts`.
- `prefs.missionSummary` is COMPUTED read-only by `getUserPrefs` (`missionSummaryLine()` — "Declared AO —" + must-tracks; the `spectrum` block is omitted) and appended to every AI call's user context.
- Two "home" concepts stay distinct: Home Location (You — forecast / local news / map centre) vs the hub (own-force airfield — posture / METAR / SITREP).

---

## AI features (`lib/aiFeatures.ts`)

Every model call is gated by `isFeatureEnabled(feature, prefs)` (master `aiEnabled` false overrides everything; per-feature toggles are opt-out). Every call is logged to `anthropic_usage` with `route`, `model`, tokens, micros and `user_email` (`lib/anthropicLog.ts logCall`, fire-and-forget); rates per model live in `RATES`.

| Feature | Route / module | Model | Notes |
|---|---|---|---|
| `chat` | `POST /api/chat` (streaming) | claude-opus-4-7 | Floating assistant; prompt-cached system block + OE context. The same key gates the on-tap reads below. |
| `chat` | `POST /api/sitrep/read` | claude-haiku-4-5 | Commander's Read (BLUF / watch / asks), 15-min cache per base + fingerprint. |
| `chat` | `POST /api/ground-truth/sitrep` | claude-sonnet-4-6 | Country SITREP in the room, 15-min cache. |
| `chat` | `GET /api/force-read` | claude-sonnet-4-6 | Force-protection read, 10-min cache. |
| `chat` | `POST /api/commands/read` | claude-sonnet-4-6 | ✦ Read on the command board, 15-min cache per fingerprint. |
| — | `GET /api/crisis-read` | claude-sonnet-4-6 | Crisis-map Demand read; session-gated, on tap, 10-min cache (no per-feature toggle). |
| `email_triage` | `GET /api/gmail` | claude-haiku-4-5 | Priority + summary + `why` + `dates`; cached 30 d by id + prompt hash; corrections ride outside the hash. |
| `email_actions` | `POST /api/gmail/actions` | claude-sonnet-4-6 | Per-message action items, cached 14 d. |
| `email_draft` | `POST /api/gmail/draft` | claude-sonnet-4-6 | Reply drafts in your voice → Gmail Drafts. |
| `email_convert` | `POST /api/gmail/convert` | claude-haiku-4-5 | Email → task / event plan. |
| `osint_triage` | `POST /api/osint/triage` | claude-haiku-4-5 | Per-item priority + reason, cached 14 d. |
| `osint_situation` | `POST /api/osint/situation` | claude-haiku-4-5 | One-line watch-officer read. |
| `doc_chat` | `POST /api/documents/chat` (streaming) | claude-opus-4-7 | Per-doc chat. |
| `family_digest` | `GET /api/family` (`lib/family.ts`) · `GET /api/family/household` (`lib/household.ts`) | claude-sonnet-4-6 | School digest + running briefs; household facts. 15-min caches; runs only when the mail set changed. |
| `newsletters` | `GET /api/newsletters` | claude-sonnet-4-6 | Newsletter bullets, cached 7 d by message id + prompt hash. |
| `briefing` | `POST /api/briefing` | claude-opus-4-7 | Morning Brief, day-cached per `(date, user, tz)`, ≤3 generations/day. |
| `digest` | `GET /api/digest` | claude-sonnet-4-6 | Weekly digest, 24-h TTL. |
| `threads` | `POST /api/threads` | claude-opus-4-7 | Threads view, day-cached by article hash, ≤3 generations/day. |
| `news_overview` | `POST /api/news/curated` | claude-sonnet-4-6 | The day's must-reads (`news_overview_cache`). |
| `news_thesis` | `POST /api/news/thesis` | claude-haiku-4-5 | Article thesis on tap, 6-h cache. |
| `quick_capture` | `POST /api/quick-capture` | claude-haiku-4-5 | Text → task / event / note / append. |
| `markets_brief` | `POST /api/markets/brief` | claude-sonnet-4-6 | Economic Warfare Read, 3-h day cache, background generate + 202 pending, `max_tokens` 3000 + JSON salvage. |
| `memory` | `lib/userMemory.ts` (background) | claude-haiku-4-5 | Memory consolidation after chat turns. |
| `news_chat` | (no route — deleted) | — | Key kept for the toggle list and ledger history. |

Ledger route names that are not feature keys are labelled through `ROUTE_LABEL_OVERRIDES` (`news_curated`, `crisis_read`, `force_read`, `ground_sitrep`, `sitrep_read`, `commands_read`, `household_digest`).

---

## Cross-cutting features

### Severity vocabulary (`lib/severity.ts`)
Force-protection severity `green < unknown < amber < red` (higher is worse; `unknown` above `green` — "UNKNOWN is not clear"). Components use `isWorse` / `worseOf` / `worstOf` (empty → `unknown`) / `byWorstFirst` / `asSeverity`, never the numbers. Disasters (`orange`), NWS severities and the household tone are deliberately separate vocabularies.

### UNKNOWN ≠ clear
A dead feed produces UNKNOWN with its reason (`live:false`, `configured:false`, source-down strips, "basemap:" badges), never an implied green. Learning-mode boards cap at WATCH; a dead sensor writes nothing to the series; a short AIS listen is `unknown`, not low traffic.

### Latency rule (bounded waits + `pending`)
No request handler awaits a cold fan-out or a model call: `getEconomicWarfare`, `getCommands`, `getDemandHorizonBounded`, `getSpectrumSummary`, `getOeSnapshot`, `getPostureMoves`, `/api/sitrep/summary`, `/api/warning` and `/api/markets/brief` start the work in the background and answer within 8–12 s (2.5 s for a chat turn) with the warm body, the last body flagged `pending`, or a `pending` stub; clients poll. Multi-MB sources are streamed (`streamCsv`).

### AI spend rules
Nothing pays on page load (Threads runs only while its view shows; Family mounts on open; triage only on the active, visible tab; palette entities on first open). Day caches with generation caps (brief, threads). Every call attributed to a user. Preferences → AI Controls shows today / 7 d / 30 d from the ledger, which is the source of truth.

### Trend learning layer (record → baseline → verify)
`lib/series.ts` (slope per observed step, direction, run, high-water, flat / weekday baselines, `precedes`, `verdict`); `lib/sensorKeys.ts` registers every `sensor_daily` key (day policy peak / last; unregistered keys refused). Verification: `lib/demandVerify.ts` scores outlooks against observed lift and posture (floor 5; `bySource` hit rates), `lib/tafVerify.ts` pairs forecast vs observed categories (floor 10 days), `lib/leadIndicators.ts` (which indicators stepped up before a level-up; 3 level-ups first), `lib/baseTempo.ts`, `lib/crewTrend.ts`, `lib/spectrumTrend.ts`, energy baseline (20 days), `rollingHigh` (5 weeks), `newPairs`. Observed days, never calendar days; floors before any rate; the app scores its OWN forecasts only.

### Chronicity (`lib/chronicity.ts`)
`new | recurring | chronic | improving | quiet | unknown` from the daily tables, ratios against days OBSERVED; a recording gap is not a recovery; UNKNOWN never accumulates. Chip on posture rows, sentence in the room, per LIMFAC function.

### Convergence (`lib/convergence.ts`, `lib/convergenceAssemble.ts`, `GET /api/osint/convergence`)
Distinct KINDS (feeds / I&W / disasters / posture / base status / pairs) pointing at one canonical subject; breadth beats intensity; feeds the primer.

### Reactivation (`lib/reactivation.ts`, `/api/osint/reactivations`)
Dormant (14+ d) saved items and doc titles / aliases re-matched against movers, non-calm boards and disasters; dismiss per interest + term.

### Watchlist (cross-domain) and suggestions
One `watchlist` drives news / OSINT / newsletter highlighting, triage context, chokepoint terms, Glance and alerts. `lib/watchlistSuggest.ts` proposes adds and drops with evidence; dismissals in `dismissed_watch_suggestions` (three namespaces: term, `drop:`, reactivation).

### Open tracking and attention gaps
`surface_opens` (base / board / country) → `lib/openSignal.ts` (palette boosts capped at 20, "You open these") and `lib/attentionGaps.ts` (subjects that stepped up since your last open, ≤3, on the OE delta card).

### Surface state ("what changed since I last looked")
`surface_state` per user: `email`, `news`, `newsletters`, `osint`, `oe`, `family`. The OE delta and the command board compare against it and bump AFTER computing; reading for the assistant or the export never bumps.

### Save-to-Docs and backlinks
▤ on news cards, email cards, OSINT clusters, action items, SITREPs, threads → `POST /api/documents` with a composed body, auto tags and an external `link` recorded in `document_links`; idempotent by link. ⧉ Append-to on the same surfaces.

### Long-term memory
One markdown doc per user in `user_memory`, updated in the background after chat turns, loaded into every chat turn, editable in Preferences.

### Theme
nightwatch (default) / amber / arctic / mission — `user_prefs.theme` (personal), `ThemeApplicator.tsx`.

---

## Client-side caches (`lib/clientCache.ts`)

In-memory, stale-while-revalidate `peek()`; `clientCache.clear()` runs after any Preferences save.

| Key | TTL | Set by |
|---|---|---|
| `news:items` | 15 min | NewsFeed |
| `news:curated` | 12 h | NewsFeed overview |
| `news:tripNews` | 15 min | NewsFeed |
| `trends:movers` / `trends:pairs` | 15 min | TrendStrip |
| `newsletters:items` / `newsletters:sourcemeta` | 30 min | NewsletterSection |
| `calendar:events` | 15 min | CalendarPanel |
| `tasks:items` | 5 min | TasksPanel |
| `gmail:emails` | 10 min | EmailTab (peeked by Calendar's Dates in your mail) |
| `briefing:result` | 15 min | briefingPrefetch / BriefingModal |
| `digest:result:v2` | 30 min | digestPrefetch |
| `markets:brief:v2` | 15 min | EconomicAccessPanel |
| `mission:profile` | 10 min | Glance (mine chips), boards |
| `osint:conflict` | 5 min | CrisisMap |
| `force-protection` | 1 min | `lib/forceProtectionClient.ts` |
| `zone:effective` | 10 min | `lib/zoneClient.ts` |

Per-browser conveniences in `localStorage` (not cross-device): `glance.clocks`, `glance.briefOpen.v2`, `glance:radar:baseline`, `prefs-active-group`, `commands.roomPinned`, `commands.afHideGreen`, `docs.appendRecents` / `docs.appendLast`, `docs-last-*`, `assistant:thread`, `family.discover.lastAuto`, `app-theme`. Cross-device UI state goes through `/api/ui-state` (`UI_KEYS` in `lib/clientUiState.ts`).

---

## Server-side caches

MySQL-backed (survive restarts):

| Cache | TTL | Purpose |
|---|---|---|
| `email_classification_cache` | 30 d | Triage by id + prompt hash |
| `email_action_cache` | 14 d | Action items per message |
| `osint_triage_cache` | 14 d | OSINT triage |
| `newsletter_cache` | 7 d | Newsletter summaries |
| `briefing_cache` | one row per (date, user, tz) | Morning Brief |
| `news_overview_cache` | one row per date | Curated must-reads |
| `thread_sessions` | one per day per article hash | Threads |
| `vip_suggestions_cache` | 12 h | Reply-pattern VIPs |

In-process (per server process; a deploy resets them):

| Module | TTL | Purpose |
|---|---|---|
| `lib/forceProtectionCached.ts` | 10 min | THE single memo over the ~15-feed force-protection fan-out (route, alerts, OE context, horizon, commands) |
| `lib/commandsAssemble.ts` · `lib/convergenceAssemble.ts` · `lib/alerts.ts` · `lib/spectrum.ts` | 5 min | Command board, convergence, alerts, spectrum summary |
| `lib/warningAssess.ts` · `lib/demandAssemble.ts` · `lib/economicWarfareAssess.ts` · `lib/sitrep.ts` · `lib/airspace.ts` | 10 min | I&W, demand, actor board, SITREP per base, DAIP per type+locs |
| `lib/chokepointReads.ts` · `lib/postureMovesAssemble.ts` · `lib/family.ts` · `lib/household.ts` · `lib/energyPrices.ts` · `lib/cyberSources.ts` (IODA) · `lib/spaceSources.ts` (scales) · `lib/infra.ts` (signals, USGS) | 15 min | |
| `lib/demandVerifyAssemble.ts` · `lib/conflictEvents.ts` · `lib/stateAdvisories.ts` · `lib/acled.ts` data | 30 min | |
| `lib/localNews.ts` (GDELT) · `lib/gpsjam.ts` · `lib/cyberSources.ts` (advisories, ransomware) | 60 min | |
| `lib/federalRegister.ts` · `lib/health.ts` · `lib/stateAdvisoryDetail.ts` · `lib/cyberSources.ts` (KEV) · `lib/spaceSources.ts` (launches 3 h) | 6 h / 3 h | |
| `lib/acled.ts` session · `lib/inform.ts` · `lib/replySignals.ts` · SOCRATES | 12 h | |
| `lib/ourAirports.ts` · `lib/holidays.ts` · `lib/whoHealth.ts` · `lib/foreignSanctions.ts` · `lib/timezoneLookup.ts` · IODA entities | 24 h | |
| `/api/osint/feed` per-feed Map | 5 min, 40-entry LRU, 12-s budget | RSS bodies |
| `/api/osint/aircraft` · `/api/osint/aircraft-mil` | 60 s · 30 s | OpenSky · military ADS-B |
| `/api/weather/*` | 3–15 min | NWS alerts / threats 3 min, METAR 5 min, forecast / current 15 min, space 10 min, here 10 min |
| `lib/aisStream.ts` | vessels age out after 5 min | AISStream bridge snapshot |
| `lib/xStore.ts` · `lib/articleStore.ts` · `lib/eventStore.ts` · `lib/noticeStore.ts` | 60 s | Capture-store read caches |
| AI reads: `/api/crisis-read` · `/api/force-read` 10 min; `/api/sitrep/read` · `/api/ground-truth/sitrep` · `/api/commands/read` 15 min; `/api/news/thesis` 6 h; `/api/markets/brief` 3 h; `/api/meeting-prep` 1 h | | |

---

## API surface (140 routes)

```
/api/auth/[...nextauth]                  NextAuth (Google)
/api/auth/gmail-secondary                GET / POST — legacy secondary-Gmail flow (?step=initiate|debug), no-store
/api/auth/gmail-secondary/start          GET — clean, nonced start of the secondary OAuth hop
/api/auth/gmail-secondary/callback       GET — code exchange → encrypted httpOnly cookie → Email tab
/api/auth/primary-hint                   POST — remember this device's primary account (httpOnly, 1 y)

/api/user-prefs                          GET / POST — shared row (owner) or personal overlay (crew); absent lists preserved
/api/user-prefs/append                   POST — whitelisted single-field appends (VIP / mute / dismissals)
/api/mission-profile                     GET / PUT declaration / POST apply (dryRun diff) / PATCH mustTrack · economy
/api/track                               GET registry · GET ?q= candidates · POST track | restore | role (owner)
/api/airfields/resolve                   GET ?icao= — curated → OurAirports labeled point
/api/airfield-capability                 GET ?icao= — longest open runway + C-17 / C-130 / light class
/api/airfield-weather                    GET ?icao= — batched flight categories + lift line for map nodes
/api/ui-state                            GET / POST patch — per-user cross-device UI blob
/api/surface-state                       GET / POST — per-surface last-seen
/api/opens                               GET / POST — open tracking (base / board / country)
/api/zone                                GET — effective zone (pinned › trip › device › pref)
/api/trips                               GET / POST / PATCH / DELETE — TDY / travel trips
/api/contacts                            GET / POST / PATCH / DELETE — keep-in-touch roster
/api/contacts/suggest                    GET — people from VIP + reply patterns
/api/settings/acled                      GET / POST / DELETE — ACLED credentials (never returns the password)
/api/settings/x-token                    GET / POST / DELETE — capture bearer token (hash stored)
/api/push/subscribe                      GET / POST / DELETE — web-push device registration
/api/alerts/check                        GET — current alert conditions (session or token); drives push dispatch + heartbeat
/api/ai-usage                            GET — spend summaries, per-route and per-user, key tail (owner)
/api/user-memory                         GET / POST / DELETE — long-term memory

/api/oe-delta                            GET — net OE change since this user's last look + attention gaps
/api/oe-brief                            GET — snapshot + open decisions for the client-rendered OE brief
/api/demand-horizon                      GET — 7-day demand outlook per COCOM + skill (bounded)
/api/posture-moves                       GET — force movements from the defense feeds (bounded)
/api/state-advisories                    GET — State Dept Level-4 / departure advisories, AOR-tagged (?debug=1)
/api/spectrum                            GET — PNT / cyber / space rollup for the Glance tile (?diag=1)
/api/briefing                            POST — Morning Brief (tz, osint, newsletters, articles in body)
/api/digest                              GET — Weekly Digest
/api/quick-capture                       POST — text → task / event / note / append
/api/chat                                POST (streaming) — the floating assistant
/api/meeting-prep                        POST — attendees' recent mail for an event

/api/news                                GET — RSS aggregation + sourceStats (records trends)
/api/news/curated                        POST — the day's must-reads
/api/news/thesis                         POST — article thesis
/api/threads                             POST — Threads session (?refresh=1)
/api/thread-history                      GET — past sessions, label timelines
/api/trends                              GET — movers, 90-day highs, new pairs (SQL only)
/api/newsletters                         GET — summarised newsletters
/api/newsletter-feedback                 POST — hide / keep / open signals
/api/article-feedback                    POST — thumbs / open signal
/api/saved                               GET / POST / DELETE — bookmarks

/api/calendar                            GET — events
/api/calendar/events                     POST / PATCH / DELETE — event writes (clean 403/404 mapping)
/api/calendar/ical                       GET — .ics feed (session)
/api/tasks                               GET / POST / PATCH / DELETE — Google Tasks

/api/gmail                               GET — unread + triage (both accounts)
/api/gmail/prefs                         POST — per-email override + keep
/api/gmail/mark-read                     POST — { done, kept, failed }
/api/gmail/rules                         GET — how priority is decided + suggested sender rules
/api/gmail/vip-suggestions               GET — reply-pattern VIPs
/api/gmail/actions                       POST — action items (cached per message)
/api/gmail/draft                         POST — generate draft (AI) / create Gmail draft
/api/gmail/convert                       POST — email → task / event (plan + create)
/api/gmail/label                         POST — Family/* label + (owner) roster tracking

/api/family                              GET (?check=1 · ?refresh=1 · ?silent=1) / PATCH — school digest; due date, state
/api/family/roster                       GET / POST — people, senders, billers, documents, switches
/api/family/household                    GET — bills, silence watch, documents, jeopardy
/api/family/week                         GET — the week ahead (brief, Glance tile)
/api/family/dates                        GET — family dates for the Calendar tab
/api/family/event                        POST — write ONE anchored date (422 otherwise)
/api/family/discover                     POST scan · POST {label} · GET ?labels=1 · PUT accept · DELETE dismiss

/api/documents                           GET / POST — list / create (idempotent by link)
/api/documents/[id]                      GET / PATCH / DELETE
/api/documents/[id]/append               POST — append a dated entry (snapshot first)
/api/documents/[id]/export               GET — single doc .md with frontmatter
/api/documents/[id]/versions             GET / POST (force snapshot)
/api/documents/[id]/versions/[vid]/restore POST — undoable restore
/api/documents/backlinks                 GET — docs referencing an external object
/api/documents/bulk                      POST — pin / unpin / tag / untag / archive / unarchive / move / delete
/api/documents/chat                      POST (streaming) — per-doc chat
/api/documents/export                    GET — zip of all docs
/api/documents/graph                     GET ?id=&depth= — local link graph
/api/documents/lexicon                   GET — term glossary
/api/documents/logs                      GET — running logs with newest entry
/api/documents/tags                      GET / POST — list / rename / merge / delete
/api/documents/titles                    GET — id + title + aliases index

/api/files                               GET list + quota / POST multipart upload
/api/files/[id]                          GET download / PATCH metadata / DELETE
/api/files/[id]/inline                   GET — inline preview
/api/files/bulk                          POST — tag / untag / attach / delete
/api/files/zip                           GET ?ids= — selected files as one zip

/api/commands                            GET ?since= — command board + primer + details (202 pending)
/api/commands/read                       POST — ✦ Read (AI)
/api/ground-truth                        GET ?country= — the situation-room dossier
/api/ground-truth/sitrep                 POST — country AI SITREP
/api/force-protection                    GET — force posture board (shared cached gather)
/api/force-read                          GET — AI force-protection read
/api/crisis-read                         GET — AI mobility-demand read of the map
/api/warning                             GET — I&W assessments (bounded)
/api/warning/decision                    GET / POST / PATCH / DELETE — decision log + calibration
/api/team/crew                           GET / POST / DELETE — crew counts, posture vs demand

/api/sitrep                              GET ?icao= — assembled SITREP
/api/sitrep/bases                        GET / POST — base set (owner)
/api/sitrep/summary                      GET — all-base LED rollups (bounded)
/api/sitrep/read                         POST — Commander's Read
/api/sitrep/limfac                       GET / POST / DELETE — shared LIMFACs
/api/sitrep/infra-diag                   GET — infra source probes (owner)

/api/osint/feed                          GET — merged feeds + captures, clustered
/api/osint/feeds                         GET / PUT — feed editor (owner writes)
/api/osint/test-feed                     POST — single-URL diagnostic
/api/osint/triage                        POST — AI triage batch
/api/osint/situation                     POST — one-line situation read
/api/osint/watchlist-suggestions         GET / POST — add / drop suggestions (owner writes)
/api/osint/reactivations                 GET / POST — dormant interests back on the board; dismiss
/api/osint/convergence                   GET — subjects several surfaces point at
/api/osint/x-import                      POST / GET / DELETE — X capture ingest
/api/capture/article                     POST / GET / DELETE — captured analysis articles
/api/capture/events                      POST / GET / DELETE — captured map events
/api/capture/notices                     POST / GET / DELETE — captured ministry notices
/api/osint/geocode                       GET — Nominatim proxy
/api/osint/aircraft                      GET — OpenSky bbox (AOR contacts strip)
/api/osint/aircraft-mil                  GET — global military ADS-B
/api/osint/ships                         GET — AISStream snapshot
/api/osint/conflict                      GET — UCDP events (ReliefWeb fallback)
/api/osint/acled                         GET — ACLED events
/api/osint/gpsjam                        GET — GPS-interference H3 cells
/api/osint/airspace                      GET ?layer=fir|gps|fuel — DAIP NOTAM groups
/api/osint/inform                        GET — INFORM Risk scores
/api/osint/outages                       GET — IODA country outage alerts
/api/osint/launches                      GET — Launch Library 2 pads ±7/14 d
/api/osint/radar                         GET — RainViewer frame index
/api/osint/crisis-diag                   GET — source health (owner)
/api/osint/map-diag                      GET — every map host fetched from production (owner)

/api/markets/brief                       POST — Economic Warfare Read (202 pending; ?refresh=1)
/api/markets/economic-warfare            GET — actor board + coercion board + timeline + leverage + EU/UK waves (?diag=1)
/api/markets/chokepoints                 GET — graded chokepoint reads + AIS transit
/api/markets/energy                      GET — Brent / WTI / natgas / gold (?debug=1)
/api/markets/regulatory                  GET — Federal Register actions (?diag=1)

/api/weather/here                        GET — where you are (effective location)
/api/weather/forecast                    GET — NWS periods
/api/weather/alerts                      GET — NWS point alerts
/api/weather/current                     GET — Open-Meteo current + daily
/api/weather/metar                       GET — decoded METAR + TAF (+ ?xwind=1)
/api/weather/threats                     GET — alerts / tropical / hazards / disasters (shared)
/api/weather/space                       GET — SWPC scales + ops impacts
```

---

## Background tasks

- **Memory consolidation** after chat turns (`lib/userMemory.ts`, debounced; pending exchanges queue).
- **Briefing / digest prefetch** (`lib/briefingPrefetch.ts`, `lib/digestPrefetch.ts`) once inputs are ready / after local midnight.
- **AISStream WebSocket** (`lib/aisStream.ts`): opened lazily; subscribes the home box plus every chokepoint box; transit counts upserted every ~3 min.
- **Daily heartbeat** (`lib/dailyHeartbeat.ts`) and **push dispatch** (`lib/pushDispatch.ts`) ride `/api/alerts/check` hits — there is no cron on this host.
- **Lazy day rollups**: posture, SITREP, I&W, indicator, demand, crew and sensor series are written on request, never by a scheduler.
- **Cache pruning**: triage / action caches prune on write; capture stores prune on import; trend tables prune to 180 / 90 / 14 days.

---

## Environment variables (`.env.example`)

```
NEXTAUTH_URL                       Public URL of the app
NEXTAUTH_SECRET                    NextAuth secret (openssl rand -base64 32)
GOOGLE_CLIENT_ID                   Google OAuth client (shared by primary + secondary flows)
GOOGLE_CLIENT_SECRET               Google OAuth secret
ANTHROPIC_API_KEY                  Claude API key
GMAIL_SECONDARY_REDIRECT_URI       Secondary-account callback (normalized to …/gmail-secondary/callback)
OWNER_EMAIL                        The admin account
ALLOWED_EMAILS                     (optional) comma-separated crew accounts
AISSTREAM_API_KEY                  (optional) live AIS — Vessels layer + chokepoint transit counts
ACLED_EMAIL / ACLED_PASSWORD       (optional) override the Preferences-stored ACLED credentials
UCDP_API_TOKEN                     (optional) Conflict layer; without it ReliefWeb fallback
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT   (optional) web push; unset = feature off
```

Platform-provided: `PORT`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`. Everything else the app reads is keyless (OurAirports, RainViewer, INFORM / Data360, WHO, SWPC, Launch Library, IODA, CISA, Federal Register, Yahoo Finance, Nager.Date, UCDP candidates, DAIP with the bundled DoD CA).

---

## Behaviors that distinguish this app

1. **Owner + crew, two kinds of state**: team config is one shared row the owner writes; personal surfaces are per user; the allowlist is re-checked on every JWT refresh.
2. **Declare, derive, materialize**: the Mission Profile is the declaration; tracking lists are derived and materialized with `mp-*` ids; manual rows win; deletions stick; one Track command and one registry.
3. **Colour is earned**: red only at ALERT / RED / NMC; learning mode caps at WATCH; a standing (chronic) condition is posture, not warning.
4. **UNKNOWN ≠ clear**: every dead feed is named, never folded into green; `unknown` sits above `green` in the severity order.
5. **Never a guessed date**: relative phrases survive unresolved; writes refuse unanchored dates at the server; NOTAM schedules are expanded per occurrence or drawn as indeterminate.
6. **Bounded latency**: no request handler awaits a cold fan-out or a model call; `pending` + polling everywhere; multi-MB sources are streamed.
7. **Nothing paid on page load**: expensive calls run on tap or when a view is actually showing, day-cached with generation caps, attributed per user; the ledger is the source of truth.
8. **The app learns from its own history**: observed-day baselines, verified forecasts, lead indicators, chronicity, reactivation, attention gaps, watchlist drops — all pure joins, no model call.
9. **Prompt-hash cache invalidation**: role / topics / watchlist edits transparently invalidate the AI caches that depended on them; corrections ride outside the hash so a cached inbox is never re-classified.
10. **Capture in the user's own browser, never scrape from the server**: X, paywalled articles, LiveUAMap, MOFCOM arrive as validated files under a hashed bearer token.
11. **Every door is an event**: `watch:focus`, `regional:select`, `docs:open`, `track:open`, `?room=`, `?prefs=` — ⌘K, Glance tiles, the primer and pasted links open the same thing.
12. **Exports are honest and self-contained**: SITREP and OE brief HTML are zero-JS, zero-external, escaped, stamped NOT LIVE.
13. **Soft-delete and undoable everything**: docs archive before delete; snapshots before split / append / restore; the Track command returns its own undo.
