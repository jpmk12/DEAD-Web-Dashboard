# NEXT-LEVEL-PLAN.md — audit & ranked plan toward "world-at-a-glance + trend sensing"

Phase-0 deliverable. No feature code has been written; the only change shipped with this
audit is a test-harness repair (`vitest.config.ts` couldn't resolve `vitest/config` from the
project tree because vitest is deliberately not installed — the esbuild ban; suite now runs
47/47 green).

Verified baseline at audit time: `npm test` → 47/47 · `node build.js` → valid
`.next/BUILD_ID` · `grep -c esbuild package-lock.json` → 0.

---

## 1. Architecture map & honest assessment

### The AI-triage pipeline (as built)

Every Claude surface follows one shape: **gate** (`isFeatureEnabled`) → **assemble bounded
context** → **one model call** (no route makes >1 call per request) → **parse with salvage**
(`extractJsonObject`) → **fire-and-forget cache write + usage log**. That shape is sound and
consistently applied.

| Surface | Model (from code) | Cache | Prompt-hash invalidation |
|---|---|---|---|
| Morning Brief | opus-class, 3072 max_tokens | `briefing_cache`, 1/day (date+tz), 7-day prune | **No** (date-keyed only) |
| Weekly Digest | sonnet-class, 2048 | client-cache only | No |
| Email triage | haiku-class, 4096 | `email_classification_cache`, 30 d | **Yes** |
| OSINT triage | haiku-class, 4096 | `osint_triage_cache`, 14 d | **Yes** |
| News Overview curate | sonnet-class, 1024 | `news_overview_cache`, 1/day, 7-day prune | **Yes** (ctx_hash) |
| Newsletters | sonnet-class, 4096 | `newsletter_cache`, 7 d | No |
| Threads | opus-class, 4096 | `thread_sessions`/`threads` (history, not cache) | n/a |
| Chat / doc-chat / news-chat | opus-class, streaming | n/a (prompt-cached system block) | n/a |
| Thesis / quick-capture / crisis-read / situation / markets-brief | haiku/sonnet, 120–1024 | in-memory maps, 10 min–6 h | No |

**Honest assessment:**

- **Strengths.** Fail-open non-AI fallbacks everywhere; ephemeral prompt caching on every
  system block; bounded context (e.g. brief = 20 articles ×150 chars + 10 newsletters + 8
  OSINT signals + 10 events ≈ 8–9 K chars); single-call routes; usage ledger with per-model
  rates and 90-day retention.
- **The pipeline triages *today*; it remembers almost nothing.** Each day's brief, overview,
  and triage calls are independent snapshots. The single existing trend signal — the Threads
  `rising|stable|fading` label persisted per day in `threads` — is (a) only generated when
  the user manually opens the Threads panel, (b) never fed back into any prompt, and (c)
  invisible to the Morning Brief. `lib/threadHistory.ts` already computes trajectory scores,
  sustained-escalation, and re-emergence per label (`getLabelSummaries`,
  `threadHistory.ts:207-270`) — and the only consumer is the Threads history panel.
  **The north-star gap is partly a *connection* gap, not a greenfield gap.**
- **Cache/invalidation model.** Prompt-hash invalidation is correctly applied to the three
  high-volume caches. The brief is date-keyed without a ctx hash — acceptable (manual ↻
  exists) but means a morning prefs change doesn't refresh the brief. Client-side:
  `clientCache.clear()` + `dashboard-cache-cleared` after prefs save is properly wired
  (`PreferencesDrawer.tsx:2051-2057`, listeners in TabShell/NewsFeed/NewsletterSection).
- **Brief/digest assembly.** Brief context is client-pre-assembled (articles/newsletters/
  events/OSINT ride in the POST), so server assembly is one best-effort
  `getWeatherThreats()` call + one model call. The structural latency risk is that
  `getWeatherThreats()` fans out to NWS/Open-Meteo/GDACS/USGS/ReliefWeb/NHC **without
  timeouts on most of those fetches** (§5) — the brief's only upstream dependency is also
  the least-guarded one. Digest is pure transformation of stored engagement data (no
  upstream risk).

## 2. Trend-sensing assessment

### What exists today (retention map)

| Store | Time-indexed? | Retention | Trend-usable? |
|---|---|---|---|
| `thread_sessions` + `threads` | per-day, UNIQUE date | unbounded | **Yes — the one real time series.** Labels + trend + sources per day, with trajectory math already in `lib/threadHistory.ts`. But populated only on manual Threads opens → gaps on un-opened days. |
| `briefing_cache`, `news_overview_cache`, `newsletter_cache` | per-day | **7-day prune** | Marginal — raw JSON snapshots, no extraction, too short a window. |
| `article_prefs` (keywords/sources), `newsletter_prefs` (openCounts) | **No** — cumulative single-row counters | capped/unbounded | No. Can say "I like X", not "X is rising". |
| `anthropic_usage` | per-call timestamps | 90 d | Yes, for cost trends only. |
| `saved_items`, `surface_state`, `user_memory` | event/state | n/a | No. |
| OSINT / crisis / ACLED / GDELT data | **none persisted** | in-memory 30–60 min | **No — the highest-value trend source retains zero history.** |

**Verdict:** "topic X this week vs last week" is *partially* reconstructable from `threads`
(with gaps); "region Y escalating" is not reconstructable from anything. Real trend
detection needs a small, deterministic, MySQL-resident counting layer.

### What it takes (proposed persistence)

Two tables, following house conventions (YYYY-MM-DD keys, BIGINT ms, fire-and-forget
prune, COLUMN_MIGRATIONS-compatible):

```sql
CREATE TABLE IF NOT EXISTS signal_daily_counts (
  date    VARCHAR(10)  NOT NULL,         -- YYYY-MM-DD in user tz
  kind    VARCHAR(16)  NOT NULL,         -- 'topic' | 'entity' | 'region' | 'category' | 'aor' | 'label'
  term    VARCHAR(120) NOT NULL,         -- normalized lowercase
  count   INT          NOT NULL DEFAULT 0,
  sources INT          NOT NULL DEFAULT 0,  -- distinct feeds/sources that day (corroboration)
  PRIMARY KEY (date, kind, term),
  INDEX idx_sdc_term (kind, term, date)
) ENGINE=InnoDB;          -- prune > 180 d (compact rows; ~1-2k rows/day worst case)

CREATE TABLE IF NOT EXISTS signal_seen (
  id   VARCHAR(40) NOT NULL PRIMARY KEY, -- sha1 of item id/link
  date VARCHAR(10) NOT NULL,
  INDEX idx_seen_date (date)
) ENGINE=InnoDB;          -- dedup ledger so polling never double-counts; prune > 14 d
```

**Recorder (zero AI cost):** piggyback on the fetch paths that already see every item —
`/api/news` (NewsItem: title/category/source/pubDate), `/api/osint/feed` (OsintItem),
`/api/weather/threats` + ACLED/GDELT (country, AOR via `aorFromCoords`). For each *new*
item (INSERT IGNORE into `signal_seen`), increment counts for: extracted keywords (reuse
`extractKeywords`, `articlePrefs.ts:23-29`), watchlist hits, category, source-country/AOR,
and — when Threads runs — thread labels. All fire-and-forget; a recorder fault can never
break a user-facing response.

**Velocity (pure SQL + tiny TS):** for each (kind, term): 7-day count vs prior-7-day count
→ ratio + absolute floor (e.g. ≥5 mentions) + corroboration (sources ≥2) → `rising` /
`new` / `fading` / `recurring` chips. Deterministic, testable, free. AI only *narrates*
the top movers (one ~300-char TRENDS block appended to the existing brief prompt — no new
model call).

## 3. Top improvements, ranked (impact × effort)

P1–P3 are the trend core; P4 protects the brief; the rest compound. Each is a small,
reviewable commit-series.

| # | Improvement | Why (north star) | Effort | Files / migrations |
|---|---|---|---|---|
| **P1** | **Trend persistence layer** — the two tables above + recorder hooks in `/api/news`, `/api/osint/feed`, `lib/severeWeather`/`lib/acled` paths + `lib/trends.ts` (velocity math) | Foundation: nothing else can sense trends without history. Deterministic, $0 AI. | M | `lib/db.ts` (+2 tables), new `lib/trends.ts`, ~4 single-line hooks |
| **P2** | **Surface trends: Brief trend callout + "Trending" strip** — brief prompt gains a TRENDS block (top 5 movers w/ counts + week-over-week); BriefingModal renders a trend section; a compact rising/fading chip strip on the News tab (and Glance) linking to filtered views | This *is* the acceptance scenario: "3 sources now on X; region Y up this week" at 0545. | M | `app/api/briefing/route.ts`, `BriefingModal.tsx`, small `TrendStrip.tsx` |
| **P3** | **Close the Threads gap** — generate the daily thread snapshot server-side alongside the brief prefetch (instead of only on panel-open), and feed yesterday's labels into the Threads prompt so labels stay stable day-to-day ("IRAN WAR" matches "IRAN WAR") | The richest curated topic series stops having gaps; trajectory math (`threadHistory.ts`) finally gets continuous data; label continuity makes week-over-week real. +1 opus-class call/day (~bounded; measure in P7). | M | `lib/briefingPrefetch.ts` or server-side equivalent, `app/api/threads/route.ts` |
| **P4** | **Reliability: timeout + never-cache-empty sweep** — shared `fetchWithTimeout()`; add AbortController to every fetch flagged in §5 (NWS alerts/forecast/METAR, Open-Meteo, GDACS/USGS/ReliefWeb/volcano, defense.gov); `Promise.allSettled` in threat aggregation; stop serving empty results into 30-min caches (GDELT/ACLED/state-advisories) | The Morning Brief's one server-side dependency (`getWeatherThreats`) is the least-guarded path in the app; a slow NWS call can hang the brief, crisis map, and Glance. Reliability here *is* SA quality. | S–M | `lib/severeWeather.ts`, `lib/disasters.ts`, `app/api/weather/*`, `app/api/markets/contracts`, `lib/conflictEvents.ts`, `lib/acled.ts`, `lib/stateAdvisories.ts` |
| **P5** | **Re-open delta: "since you last looked, what changed + what's trending"** — brief modal (and Glance header) shows deltas vs `surface_state.last_seen_at`: new high-signal items, trend chips that changed state, counts | Second half of the acceptance scenario: later-in-the-day opens stop re-litigating the morning. | M | `surface_state` (already exists), `lib/trends.ts`, `BriefingModal.tsx`/Glance |
| **P6** | **Failed-vs-quiet signaling** — standardize `{ ok, fetchedAt, stale }` on data routes that currently blank silently (§5 list); small amber "source unavailable" badges in the consuming panels (generalize the OSINT health-dot pattern) | A planner must distinguish "AOR quiet" from "feed down" — today eight routes return 200+empty on failure. False quiet is the most dangerous failure mode an SA tool can have. | M | ~8 routes + their panels |
| **P7** | **Instrumentation before optimization** — per-phase timing (assembly vs model) logged into `anthropic_usage.route` suffixes or a tiny `perf_log`; a 7/30-day cost+latency rollup already half-exists (`/api/ai-usage`); add p50/p95 to the Preferences usage card | The prompt demands measured baselines; the sandbox has no prod DB, so this ships first and every later claim cites it (§4). | S | `lib/anthropicLog.ts`, `app/api/ai-usage` |
| **P8** | **Email smart drafted replies** (productivity axis) — for High-priority needs-reply emails, draft in user voice (Sent-folder sample), one-click `drafts.create` (`gmail.modify` already scoped — no re-auth) | Top time-buy-back item; already user-acknowledged as highest-leverage productivity work (SESSION-CONTEXT quick-pick #1). Drafts are safe (nothing auto-sends). | M–L | `app/api/gmail/draft/route.ts`, EmailTab |
| **P9** | **Test the load-bearing logic** — `senderMatches` (untested!), prompt-hash stability, `disasters.dedupe`/haversine, `assessHazards` thresholds, and the new `lib/trends.ts` velocity math + recorder dedup | Guards the regressions that have actually bitten; trend math must be provably right before the brief asserts "X is escalating". | S | `tests/*` |
| **P10** | **OSINT per-item dismiss/bookmark** (supporting) — clear-the-pile hygiene so the signal list stays signal | Recurring user pain; small; reduces noise feeding triage and trends. | S | OSINTTab + small `osint_dismissed` migration or prefs column |

Deliberately **not** in this run: People/CRM, Research Topics, new tabs, map overlays —
real ideas, but none beats P1–P6 on "see a trend earlier" per unit effort.

**Suggested sequencing:** P7 → P4 → P1 → P2 → P3 → P5 → P9 (continuous) → P6 → P8 → P10.
(P7/P4 first so every later change has baselines and a stable upstream.)

## 4. Performance & cost pass

**What is measurable from this sandbox (measured):** `npm test` 1.2 s, 47 tests; prod
build ~20 s compile; BUILD_ID valid; esbuild count 0. **What is not:** live latency and
spend require the prod DB (`anthropic_usage`) and real upstreams — the container here has
neither DB credentials nor a populated ledger. Per the "measured baselines, not guesses"
bar, P7 ships first; the numbers below are *code-derived facts*, labeled as such.

**Code-derived cost structure (per call, from each route's model + caps + rates table in
`lib/aiFeatures.ts`):**

- Daily fixed: brief (opus-class, ~9 K-char context, ≤3072 out) ≈ the single most expensive
  scheduled call; overview curate (sonnet, ≤1024 out) — cheap; digest weekly (sonnet).
- Volume-driven: email triage + OSINT triage (haiku, prompt-hash cached 30 d/14 d — warm
  days are nearly free; a role/topics edit invalidates both → one expensive re-triage day;
  this is by design but worth showing in the usage card so the spike is explicable).
- Interactive: chat/doc-chat/news-chat/threads (opus-class) — entirely user-driven.
- P3 adds one opus-class threads call/day; mitigation if the ledger shows it matters: drop
  threads to the sonnet tier and verify label quality (measure, then decide).

**Code-derived latency facts:** brief = client-assembled context + 1 weather sub-call + 1
model call (no serialized independent awaits found — the audit confirmed `Promise.all`
usage in gmail/newsletters/digest paths). The dominant un-bounded variable is
`getWeatherThreats()` (§5): NWS alerts/forecast, Open-Meteo per-location loop, and 4 of 5
disaster sources have **no timeout**; one slow upstream holds brief/crisis/Glance.
`/api/osint/feed` already has the right pattern (per-feed 8 s + 12 s overall
`Promise.race` budget) — P4 ports that pattern everywhere.

**Acceptance for this section:** after P7+P4, report a before/after week of: brief p50/p95
end-to-end, weather-threats p95, per-route daily spend, cache hit rates (cache_read vs
input tokens), and the prefs-edit re-triage spike.

## 5. Reliability pass

**Previously-bitten failure modes — guard status (verified):**
- VIP cache not clearing on prefs save → guarded (`PreferencesDrawer.tsx:2051-2057` +
  `dashboard-cache-cleared` listeners). Keep both halves; covered by house rules.
- Cold-fetch on modal open → mostly guarded (prefetch re-fires on focus/visibility/
  cache-cleared), but both prefetchers swallow errors (`digestPrefetch.ts:24`,
  `briefingPrefetch.ts:31`) — a failed prefetch silently degrades to cold open. P4 adds a
  retry-on-next-focus.
- OSINT 0-items → partially guarded: per-feed `ok:false` exists and the editor's Test
  button diagnoses; the *pane* distinguishes failed vs quiet only in the empty state.

**New findings (severity-ranked, from the fetch-surface audit; file:line in the audit
notes):**
1. **CRITICAL — no timeouts in the weather/disaster stack**: NWS alerts (`severeWeather.ts:27-50`),
   NWS forecast (2 sequential un-aborted fetches, `weather/forecast/route.ts`), METAR/TAF,
   Open-Meteo per-location loop (`severeWeather.ts:246-271`, `Promise.all` — one slow
   OCONUS location holds the whole board), GDACS/USGS/ReliefWeb/volcano (`lib/disasters.ts`),
   defense.gov contracts. These feed the brief, crisis map, weather tab, and Glance.
2. **HIGH — error results cached as truth**: GDELT/ACLED/state-advisories serve a 30-min
   blank layer after one failed fetch (a Level-4 advisory issued during downtime stays
   hidden); RSS stale-cache never expires on repeated failure.
3. **HIGH — eight routes return 200 + empty on failure** (conflict, gpsjam, forecast,
   metar, alerts, contracts…) — "false quiet". P6 standardizes the envelope + badges.
4. **MEDIUM — test gaps on load-bearing logic**: `senderMatches` (VIP/mute), prompt-hash
   stability, `disasters.dedupe`, `assessHazards`. P9.
5. **Repaired during audit**: `npm test` itself was broken (vitest.config import) — the
   verification loop was dead until this session.

**Regression guards to ship with P4/P9:** unit tests for `fetchWithTimeout` semantics,
never-cache-empty behavior (mock a failing fetch, assert cache untouched), recorder dedup
(same item twice → one count), and velocity edge cases (zero prior week, new term, fade).

## 6. Risk list (deploy & data)

1. **esbuild ban** — none of P1–P10 adds a dependency; trend math is pure TS. Gate after
   any lockfile change: `grep -c esbuild package-lock.json` → 0 (it is the *real* deploy
   gate, alongside fresh `omit=dev` install + `node build.js` → BUILD_ID).
2. **Schema changes** — P1/P10 use `CREATE TABLE IF NOT EXISTS` + `COLUMN_MIGRATIONS`
   only; additive, idempotent, no destructive ALTERs. Preview/prod share one MySQL — new
   tables must be backward-compatible with the still-deployed old code (they are: nothing
   old reads them).
3. **Recorder write amplification** — `/api/osint/feed` polls every 90 s; without the
   `signal_seen` dedup ledger the counts table would inflate and skew trends. The ledger is
   load-bearing, not optional; prune at 14 d keeps it ~small.
4. **Trend-table growth** — worst case ~1–2 K rows/day → ~360 K rows at 180-day retention;
   fine for managed MySQL, but pruning must be fire-and-forget like the existing caches.
5. **Prompt edits = cache invalidation = cost spike** — P2 changes the briefing prompt
   (date-keyed, 1/day — no spike) but any future tweak to triage system prompts re-triages
   the whole inbox/feed once. Acceptable; surface it in the P7 usage card rather than
   suppress it.
6. **Secrets** — trend layer stores derived counts only (no article bodies, no email
   content beyond keywords already derived from public news/OSINT titles). Email-derived
   terms must NOT enter `signal_daily_counts` (private data in a long-retention table);
   the recorder only hooks public-source paths. ACLED password pattern (dedicated columns,
   encrypted at rest, never in the prefs GET) stays untouched.
7. **P8 drafts** — `drafts.create` writes drafts, never sends; still outward-adjacent, so
   the UI keeps a human click between draft and send, and the feature ships behind an AI
   toggle like everything else.
8. **P3 server-side threads** — runs under the briefing prefetch's auth context; must not
   create a path that calls Google APIs without a valid session token (reuse the existing
   prefetch trigger, which only fires on authenticated requests).

---

**Definition of done for the run** (unchanged from the brief): at 0545 the brief answers
"how did the world move and what's *trending*", a later re-open answers "what changed since",
false-priority items go down (failed-vs-quiet fixed, triage measured), `npm test` green and
the prod-style build + esbuild gate intact at every commit.
