# SESSION-CONTEXT.md — handoff for the next Claude session

A short orientation doc so the next session can pick up without losing
context. Tracks the most recent push, known open threads, and what to read
to ramp up.

**Default branch (source of truth):** `claude/dead-web-dashboard-refactor-16sA7`
— kept fully updated. `claude/kind-cray-bbas25` is a mirror kept at the same
commit (a later session developed there, then synced back); develop on
`refactor-16sA7` going forward and keep the two pointing at the same SHA.

---

## ✅ Post-deploy checklist (verify after the deploy that includes commit `48934bb`)

The sandbox can't reach most external data hosts, so these need a live glance.
Owner-only debug routes require logging in as `OWNER_EMAIL`.

1. **UCDP conflict** (token now installed) — open `/api/osint/crisis-diag`: the
   UCDP section should show a working version + recent newest-event date (not
   401/ReliefWeb). On the Crisis map's Conflict layer, expect **multiple
   countries** (not just the active war) and **a date on each** event popup /
   watch-list row. If still 401 with the token set → token wrong/expired/space.
2. **Energy panel** — `/api/markets/energy?debug=1` → Yahoo `ok:true` per symbol.
   Economy tab shows WTI/Brent/NatGas/Gold with correct **day %** (not a 5-day
   move) and clickable values. If Yahoo 403s from the host, ping me for an
   EIA/key-based source.
3. **State advisories** — `/api/state-advisories?debug=1` → `parsed > 0`,
   `withLevel > 0`. Regional → a watched country's **⚖ Civil / political** card
   shows the State level (e.g. Iran Level 4) + indicator pills. `status:403/0` =
   travel.state.gov blocked from the host → needs a fallback.
4. **Morning brief Schedule** — open Brief: today's **agenda** appears under
   Schedule. If a brief was cached empty earlier today, hit ↻ once (sends current
   events + `?refresh=1`); correct automatically from tomorrow.
5. **Weather cards** — condition **vector icons** + per-period mini-icons; the
   feels-like / humidity / gusts / sunrise-sunset row (needs `/api/weather/current`
   live); an OCONUS card shows current conditions instead of going blank.
6. **Crisis "All disasters (N)"** expander — under the ⚠ Watch list; expands to
   the full AOR feed (matches the Weather tab's Global Disaster Watch).
7. **WHO Host-nation health card** (Regional) — `✚ Host-nation health` shows the
   GHO indicator strip (UHC, water, sanitation, malaria, DTP3, measles) with data
   years, under any active WHO outbreaks. If a country is blank, GHO is reachable
   but an indicator **code** is likely off — tell me the country and I'll confirm
   the code against the live API (ghoapi.azureedge.net).
8. **Active conflict reporting banner** (Regional) — for an active-conflict
   country the dossier **leads** with a red/amber banner (freshest headline +
   count). Hidden when quiet.
9. **Conflict caching** — DevTools → `/api/osint/conflict` response carries
   `Cache-Control: private, max-age=300`; repeat map opens paint instantly.

---

## 🆕 SITREP v1 — post-deploy verification + v2 kickoff

v1 shipped (`0a8b2af` + review fixes): OSINT → SITREP pane, KWRI seeded with
ZNY center. After deploy:
1. Open OSINT → SITREP. KWRI card should populate; check the four LEDs and
   that DAIP-backed sections (NOTAMs + ZNY center) show data, not UNKNOWN
   (UNKNOWN there = DoD CA / DAIP reachability issue, same as Force
   Protection).
2. Commander's Read should render 3 bullets (requires `chat` AI feature on).
3. ~~v2 gate~~ **DONE 2026-07-06**: the user ran `GET /api/sitrep/infra-diag`
   from prod and pasted the JSON. Findings now encoded in code + CLAUDE.md:
   IODA live BOTH endpoints (but `from`/`until` MUST be epoch seconds —
   `now-1d` is silently zeroed; NJ region = 4453 via entities search);
   USGS live (WaterML envelope); FAA NAS live (XML Delay_type sections);
   GDELT fresh probe 429'd → power stays news-derived from the local-news
   fetch we already make.
4. **Infrastructure card is LIVE** (`lib/infraSignals.ts` pure+tested,
   `lib/infra.ts` fetchers): IODA internet drop% chips, FAA NAS national
   counts + ≤250 km nearby ground stops/closures, USGS gauge levels
   (informational), power/comms news-derived + labeled. `status.infra` is
   now computed (was hardcoded "u"); Commander's Read includes infra lines.
   Verify on next deploy: SITREP → Infrastructure card shows IODA chips and
   NAS counts for KWRI (a quiet day reads "no degradation detected").
   ~~Remaining extras menu~~ → **v3 SHIPPED (all three, user-approved from
   mockup)**: multi-base LED tile strip (`/api/sitrep/summary` +
   `sitrepSummary()` deterministic rollups), Morning Brief "⚑ Base SITREP"
   block (same route, fetched live on open — never cached into the brief),
   closure-window timeline (`closureWindows`/`windowConflicts` pure+tested;
   bars only from parseable B)/C) times, runway×IFR conflicts called out).

## Crisis-diag capture (2026-07-06, prod) — source truth
- **UCDP: WORKING.** `UCDP_API_TOKEN` is set and accepted. Version 26.0.4,
  newest event 2026-04-03 (~3-month candidate lag is normal). 26.1 also
  live; 25.1 returns 0 rows (expected, superseded).
- **ACLED: authenticated but tier-restricted** — read 200, count 0, tier
  allows only events ≥12 months old (≤2025-07-06). The live strikes layer
  stays empty on this account; UCDP is the working current-events source.
  To fix: request recent/real-time access from ACLED (their access form),
  else leave as-is — the map already falls back cleanly.
- **GPSJam: working with a 1-day lag** — today's file 404s until published;
  yesterday 200 (~1 MB). Confirmed CSV header:
  `hex,count_good_aircraft,count_bad_aircraft`.
- **OurAirports: 5,276 fields loaded. INFORM Risk: 191 countries (2022).**

## 🆕 X capture tool — Phase 1 SHIPPED, Phase 2 gated on real captures

Direction approved: NO server-side X credentials (paid API + datacenter
blocks + ban risk). Instead: **bookmarklet captures rendered x.com posts →
versioned JSON file → dashboard import**.
- **Phase 1 is BUILT** (see CLAUDE.md "X capture import" for the full map):
  `lib/xImport.ts` pure parser (+ `tests/xImport.test.ts`), `x_items` table
  (post-id PK = idempotent re-imports; prune 14 d / newest 1000),
  `POST/GET/DELETE /api/osint/x-import`, merge into `/api/osint/feed` as kind
  `social` labeled `𝕏 {source}` (rides clustering/watchlist/triage/trends),
  `XImportCard` on the Social pane (drag-drop + file + status chips + Clear +
  bookmarklet installer), readable bookmarklet source in
  `tools/x-capture-bookmarklet.js` minified into `lib/xBookmarklet.ts`.
- **User test loop**: copy the bookmarklet from OSINT → Social → Bookmarklet,
  save it as a browser bookmark, run it on an x.com list/bookmarks view, drop
  the downloaded JSON on the card.
- **Phase 2** (NEXT, needs the user): if a capture comes back with missing
  authors/text/metrics, the user saves the x.com page HTML (Ctrl-S) and
  uploads it in chat; fix the selectors in `tools/x-capture-bookmarklet.js`
  against the real markup, re-minify into `lib/xBookmarklet.ts` (parse-check
  both with `new Function`). Same capture-then-build pattern as DAIP.
  Phase 3 optional: direct-POST with device token / extension.

## Ramp up in 5 minutes

1. **`FEATURES.md`** at the repo root — comprehensive parity spec. Every
   tab, every AI feature, every endpoint, every cache. Start here.
2. **`public/user-guide.html`** — in-app user docs, served at
   `/user-guide.html`, linked from Preferences. Mirrors the user-facing
   surface in plain language.
3. **`CLAUDE.md`** — deployment guidance for the GoDaddy Node.js Hosting
   platform. Don't touch the constraints noted there (build toolchain in
   `dependencies`, `process.env.PORT`, etc.).
4. **`ROADMAP.md`** — historical commit-trail of features. Useful for
   understanding why a thing was built the way it was.
5. **The recent commit log** — `git log --oneline -25` shows what the
   user has been focused on lately.

---

## What just shipped (recent → older)

| Commit | Change |
|---|---|
| `972a6e6` | Digest: Reading Patterns no longer truncated. Bumped per-field caps (1500/1000/400), `max_tokens` to 2048, prompt loosened, cache key bumped to `digest:result:v2` |
| `cfde19f` | Digest + Briefing prefetch re-fires on `focus` / `visibilitychange` / `dashboard-cache-cleared` (custom event from prefs save). Fixes "modal cold-fetches after prefs save" |
| `5f8ebe4` | `FEATURES.md` — comprehensive parity spec |
| `fd2d136` | File repo on Docs tab (📁 Files toggle, 30 MB per-file, 250 MB quota, MySQL BLOB backend, image/PDF/text preview, attach-to-doc) |
| `a09c016` | Version history (last 25 snapshots per doc, 5-min throttle, undoable restore) |
| `ecd5a5f` | Export — single doc as `.md` with YAML frontmatter, all docs as zip |
| `05b21f1` | Multi-tag filter (Any/All), Stale view, Longest sort, URL hash state |
| `ebe9ae7` | Archive (soft-delete with restore, hidden from chat context) |
| `2a6b1b8` | Bulk multi-select actions (pin/unpin/tag/untag/archive/delete) |
| `2e76652` | Tag manager modal (rename/merge/delete across all docs) |
| `727534b` | Docs sidebar v1 — smart views, sort, clickable tag chips |
| `cfecda3` | Fix: VIP/mute changes apply immediately (clientCache.clear on prefs save) |
| `248f701` | User guide: Best Practices section |

The branch is in a **clean state** — build green, all features documented,
no half-shipped work.

---

## Open threads / things mentioned but not pursued

These are conversations the user surfaced but didn't pick up — pick from
the list if the user comes back hungry for more.

### ⏳ Waiting on external — TRACKED

- **UCDP API token** (Crisis map "Conflict" layer + Force Protection conflict
  axis). UCDP requires a token (`x-ucdp-access-token`); without it the Conflict
  layer falls back to coarse keyless ReliefWeb. **Status (2026-06-18): token
  RECEIVED from UCDP — install pending.** To install: set `UCDP_API_TOKEN=<token>`
  in the Node.js Hosting env (Settings → environment variables), redeploy/restart
  so it's picked up. No code change — `ucdpHeaders()` in `lib/conflictEvents.ts`
  reads it and `resolveVersion()` then returns precise events. Verify via
  `/api/osint/crisis-diag` (UCDP section): should flip from 401/ReliefWeb to a
  working version + newest event date. Note: ACLED's free tier still embargoes
  data <12 months, so the keyless **conflict-news** signal (`lib/conflictNews.ts`)
  remains the timeliest read regardless.
- **Host-nation health card** (WHO GHO) — APPROVED, mockup built
  (`host-health-mockup.html`), pending implementation. Add a "✚ Host-nation
  health" block to the Regional dossier: live WHO DON outbreaks (already wired) +
  a GHO OData structural indicator strip (physicians/beds per 10k, UHC index,
  basic water/sanitation %, malaria, DTP3/measles, life expectancy), keyless,
  same OData pattern as INFORM. Confirm GHO indicator codes against the live API
  at build time. Optionally feed the Force-Protection health axis.

### Offered but not chosen
- **Per-domain spec split** — I offered to break `FEATURES.md` into
  `DOCS-SPEC.md` / `OSINT-SPEC.md` / etc. so different teams own different
  surfaces. User didn't say yes or no.
- **"Files attached to this doc" chips in the doc footer** — natural next
  beat after shipping the file repo, but not asked for yet.

### Things the user might run into and ask about

- **AISStream maritime map**: requires `AISSTREAM_API_KEY` env var on the
  platform. Without it the banner shows a friendly "not configured" message.
  Free signup at aisstream.io.
- **Twitter/X RSS bridges**: fundamentally upstream-broken (X blocks
  scrapers, public rsshub instances rate-limit). The diagnostic test panel
  + suggested alternative-instance swap is the best we can do without
  asking the user to self-host RSSHub. Documented in the OSINT Feeds
  editor's `<details>` help section.
- **VIP self-email**: the user added their own email as a VIP and was
  confused why nothing flagged. VIP matches the From header — sending mail
  TO yourself isn't covered. Not a bug, but worth confirming if they ask
  again.

### Roadmap items still open

Original menus from earlier turns. Pick by user pain or by impact.

**Docs (would build cleanly on what's there now):**
- ⬆ Self-host RSSHub quickstart panel — was offered when discussing the
  OSINT Twitter problem
- AI doc helpers: ✨ Summarize button (TL;DR generation), suggested wiki-
  links (Claude scans body for proposed `[[links]]`), auto-tag suggestions
- "Files attached to this doc" chips in the doc footer
- Find/replace **across docs** (multi-doc global rename)
- Templates for new docs

**OSINT:**
- Per-item bookmark / dismiss (current per-cluster save-to-docs is the only
  per-item action)
- Image preview from RSS feeds with `<media:content>` (X bridges + Telegram
  bridges usually have images)
- Translate non-English items (one-click via Claude)
- Notable callsigns watch as a separate pref (currently piggybacks on the
  unified watchlist — works fine but could be cleaner)

**Email:**
- Smart drafted replies — was scoped early in the project, then deferred
  per user request. Gmail's `gmail.modify` scope already covers
  `drafts.create`, so no re-auth needed when the user wants to revisit.
- Save calendar event prep as doc (attendee history + previous related
  docs) — would pair well with the doc-chat feature

**Self-rendered maps follow-on:**
- Track click history — let the user save a vessel/aircraft to a list and
  it gets highlighted on every subsequent fetch
- NOTAM overlay for the aircraft map
- Port congestion overlay for the maritime map

---

## Things to verify if the user reports something weird

A short troubleshooting cheat sheet for the common failure modes I've seen
or anticipated this session:

1. **Email triage not respecting a new VIP/mute** → was a real bug, fixed in
   `cfecda3`. If it surfaces again, check that PreferencesDrawer.save still
   calls `clientCache.clear()` AND dispatches `dashboard-cache-cleared`.
2. **Digest / Briefing modal slow on open** → was a real bug, fixed in
   `cfde19f`. Check the `dashboard-cache-cleared` event listener in
   `components/layout/TabShell.tsx` still wires `prefetchDigest` /
   `prefetchBriefing`.
3. **Digest Reading Patterns cut off** → was a real bug, fixed in `972a6e6`.
   If it recurs, check the per-field `.slice(...)` caps in `/api/digest`.
4. **OSINT feed returning 0 items** → use the Test button on the feed row.
   Hints map common failure modes to specific advice; alternative URLs
   surface as one-click swap buttons.
5. **Maritime map showing the "not configured" banner** → AISSTREAM_API_KEY
   env var needs to be set on the platform.
6. **Build fails** → most likely cause is a build toolchain dep accidentally
   moved to `devDependencies`. CLAUDE.md spells out which packages must
   stay in `dependencies`.

---

## House-style notes for the next session

Patterns I've been following — keeping them consistent will make the
codebase feel coherent.

- **Comments only when the WHY is non-obvious.** No "this fetches the
  user" narration. Comments document hidden constraints, race conditions
  the code is guarding against, choices that need explanation.
- **AI feature gating via `isFeatureEnabled(feature, prefs)`** with a
  graceful non-AI fallback in every route. Never 503 just because AI is
  off.
- **Prompt-hash-driven cache invalidation** — every AI cache key includes
  a hash of the system prompt (which includes user context). Editing role
  / topics / watchlist transparently invalidates everything that depended
  on them.
- **Capture buttons everywhere** use the same ▤ pattern + idle/saving/
  saved/error UX. New surfaces should follow the same look.
- **`clientCache.clear()` after prefs save** — derived data refetches
  immediately. Don't drop this without dispatching `dashboard-cache-cleared`
  in its place.
- **Server-side timeouts on all outbound fetches** — RSS feeds, OpenSky,
  Nominatim, NOAA, etc. Default is 8-12s. A slow upstream shouldn't hold
  the user-facing response.
- **Commit messages are detailed.** They explain the problem the change
  solves, not just what it changes. The user uses them as a changelog.
- **Don't include the model ID** (e.g. `claude-opus-4-7[1m]`) in commit
  messages, PR titles, or code comments — it's chat-only per the
  instructions.

---

## Quick-pick "what would I work on next"

If the user comes back and says "pick something":

1. **Email smart drafted replies** — scoped early, deferred. Highest
   user-leverage thing left. Gmail `gmail.modify` scope already covers it.
2. **AI doc helpers** (Summarize button + suggested wiki-links + auto-tag)
   — completes the "AI as writing assistant" arc that the per-doc chat
   panel started.
3. **Per-item bookmark/dismiss in OSINT** — cleaning up the read pile is a
   recurring user pain.
4. **Self-host RSSHub quickstart panel** — direct fix for the recurring
   "Twitter feeds don't work" complaint that no public bridge can
   reliably solve.

I'd start with #1 unless they have a specific pain point.

---

Good luck.
