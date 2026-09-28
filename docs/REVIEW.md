# Application review — against the north star

> **North star:** sense and make sense of the world, so I can be the best C-17
> commander — see changes in the operational environment, and ensure my team is
> postured to take advantage of them.

Reviewed 2026-09-28. Scale at review: 9 tabs, 112 API routes, 152 lib modules,
82 components, 69 test files / 731 tests.

---

## 1. Verdict

As a **world-sensing instrument** this is genuinely strong, and stronger than
most things of its kind. The disciplines that make it trustworthy are real and
consistently applied: UNKNOWN is never clear, colour is earned, a guessed value
is never shown, learning-mode floors everywhere, every model call attributed and
day-cached. Those are the hard parts and they are done.

Against the north star as *written*, there are three gaps. One is structural and
large; two are correctable in a day each.

| North-star clause | State |
|---|---|
| sense the world | **Strong.** ~30 feeds, fail-safe, attributed |
| make sense of it | **Good and improving.** I&W anomaly engine, convergence, reactivation |
| see *changes* in the OE | **Partial.** Four daily history tables, no unified "what moved" |
| **ensure my team is postured** | **Largely absent.** See §2 |
| take *advantage* of changes | **Absent.** Everything is framed as degradation. See §5 |

---

## 2. The structural gap: the app has no model of your team

This is the biggest finding and it is a north-star miss, not a code defect.

I grepped the whole codebase for the vocabulary of a squadron — crew rest, duty
day, currency, qualification, alert posture, manning, aircrew availability. The
only occurrence anywhere is a **placeholder string** in the LIMFAC form
(`SitrepMissionImpact.tsx`: "Add commander-known LIMFACs (ARFF, MHE, manning,
barriers, fuel, MOG)"). There is no people model, no crew state, nothing that
knows how many crews you have or what condition they are in.

So the app can tell you, with real precision, that Bab el-Mandeb is being
interdicted and that KWRI is PMC for weather — and it cannot tell you whether
you have the crews to do anything about either. "Postured to take advantage" is
half the mission statement and close to zero percent of the application.

**What this looks like built** (in rough order of value per unit of work):

1. **Crew state as declared data**, exactly like the Mission Profile pattern:
   a small roster of crews with qualification level and availability, stored in
   its own column, edited in Preferences. Declared, not inferred — the same call
   `FamilyDocument` makes about passport expiry, and for the same reason: this
   data never arrives in a feed.
2. **Posture against demand.** The app already derives mobility demand
   (`/api/crisis-read`, the HADR scoring, the I&W divergence sensor). Joining
   declared crew availability to derived demand produces the sentence the north
   star actually asks for: *"CENTCOM demand is rising and you have two crews
   inside crew-rest."*
3. **LIMFACs already have the right shape.** `sitrep_limfacs` is shared per
   base, crew-maintained, attributed by `entered_by`, with a conservative
   auto/manual split. That is the correct model for team-state data, and it is
   currently used only for airfield limitations. Extend the pattern rather than
   invent a second one.

**Caution:** this is the one area where the app would hold data about named
people's readiness. It should follow the Family tab's discipline — its own
column, owner-gated, never in the shared prefs blob, and never sent to a model
without a specific reason.

---

## 3. Learn better

Today's work closed the biggest loops (chronicity, reactivation, convergence,
the decision log, and six Family/Household surfaces). What remains:

### 3.1 Four daily history tables, no unified "what moved"

> **Addressed** — `lib/oeDelta.ts` + `/api/oe-delta` + `OeDeltaCard`, mounted above the morning brief on Glance (also the first step on §5.3 and §5.4: the card leads the front door with change, and improvements are first-class).

`warning_daily`, `force_posture_daily`, `sitrep_status_daily` and
`signal_daily_counts` all now accumulate daily state. **Each is read only by the
feature that writes it.** There is no surface that answers *"what changed in the
operational environment since I last looked"* across all four — which is,
verbatim, the north star's third clause.

`surface_state` tracks per-surface last-seen for new-item dimming, so the
"since you last looked" primitive exists. Nothing joins it to the history.

**Recommendation:** an OE delta read — one card, computed, no model call:
posture changes, LED transitions, I&W level/trajectory moves, and new trend
movers since your last visit. This is the single highest-value remaining
learning surface and it is pure arithmetic over data already stored.

### 3.2 The decision log should feed the sensors, not just the analyst

`warning_decisions` now records calls and scores them. Once there are enough
scored entries, the hit rate is per-indicator — which means it can say *which
indicators are earning their place*. Nothing consumes that yet. A low-hit-rate
indicator should eventually be visibly down-weighted or flagged for retirement,
the same way the watchlist proposes drops.

Do not automate the down-weighting. Propose it, with evidence, and let the
analyst dispose — the rule the whole board is built on.

### 3.3 Nothing learns from what you *open*

`article_prefs` records opens for news. No other surface does. The app cannot
tell which SITREP bases you actually read, which I&W indicators you expand,
which countries you drill into. That is the cheapest implicit signal available
and it is collected on exactly one surface.

---

## 4. Be more cohesive

### 4.1 `SEV_RANK` means the opposite thing in different files

> **Addressed** — `lib/severity.ts` (one direction, helper-only access, ordinals pinned by test); `COCOM_LABEL` consolidated into `lib/aor.ts`. Disaster/NWS/wellbeing vocabularies deliberately left separate.

Severity ordering — the most fundamental vocabulary in a threat application — is
defined **six times**, in two contradictory directions:

| File | Definition | Direction |
|---|---|---|
| `lib/forceProtection.ts` | `{green:0, unknown:1, amber:2, red:3}` | higher = worse |
| `lib/disasters.ts` | `{red:0, orange:1, green:2, unknown:3}` | lower = worse |
| `lib/severeWeather.ts` | `{Extreme:0 … Unknown:4}` | lower = worse |
| `lib/accountJeopardy.ts` | `{red:0, amber:1}` | lower = worse |
| `components/osint/ForceWatchBoard.tsx` | `{red:0, amber:1, unknown:2, green:3}` | lower = worse |
| `components/ground/GroundTruthTab.tsx` | `{red:0, amber:1, unknown:2, green:3}` | lower = worse |

**No live bug found** — each file is self-consistent. But `ForceWatchBoard`
consumes `forceProtection`'s data using the *opposite* convention, and has had
to annotate the comparison (`// lower rank index = more severe`) to stay
readable. Any future move of a comparison across that boundary is silently
backwards, and the failure would be invisible: a board that ranks calm above
critical still renders perfectly.

This is the same problem `lib/icons.tsx` already solved for glyphs — "change
icons there, not at call sites, so one glyph keeps one meaning". Severity
deserves the same home: one `lib/severity.ts` with one direction and a
`worseThan()` helper, imported everywhere. Pure, so client components can use it.

`COCOM_LABEL` (2 copies) and `SEV_DOT` / `SEV_TEXT` (3 copies) belong there too.

### 4.2 Four different things are called "watch"

- the Crisis map's **⚠ Watch** list (curated disasters)
- the **Mobility Watch** board (force protection)
- I&W **watch problems** (and `watch` as a warning *level*)
- the **watchlist** (search terms)

A commander scanning this cannot tell from the word which surface they are on.
Renaming is cheap and would repay itself immediately.

### 4.3 I introduced a second "convergence" today — my error

The Crisis map already had a convergence strip (AORs where ≥2 signal kinds
stack). I added a cross-surface `ConvergenceCard` on the same pane without
reconciling them. They now sit within a few hundred pixels of each other, use
the same word, and compute different things at different granularities.

**Fix:** the map's AOR strip should go, and the card should absorb it — the
card's grouping (by subject) is strictly more useful than by combatant command,
which was the original strip's known weakness. I should not have shipped both.

---

## 5. Present data more cleanly

### 5.1 The Watch pane is now overloaded — also partly my doing

It currently stacks: Convergence card → Reactivation card → I&W strip → SITREP
LED strip → Crisis map (which itself contains a convergence strip, a watch list,
an "all disasters" expander, and the Mobility Watch board). That is four
independent ranked lists before the map, and three more inside it.

Each was individually justified. Together they are a wall. The pane needs an
explicit hierarchy — *what needs a decision* above *what changed* above *the
picture* — and the cards below the fold should collapse by default.

### 5.2 Two files are 1,400+ lines

`GlanceTab.tsx` (1,420) and `CrisisMap.tsx` (1,451). CrisisMap has a documented
reason (one Leaflet tree, ~15 layers) though its layer definitions could be
extracted. Glance has no such reason and is the **front door** — the first thing
seen every morning, and the hardest file to change safely.

### 5.3 Glance does not lead with change

Glance's order is: greeting → morning brief (day-cached AI prose) → needs you
now → breaking → today → tomorrow → context. The hero is **cached text**, while
the live, earned signals (SITREP LEDs, I&W levels, posture deltas) appear below
it or not at all.

For a north star whose verb is *see changes*, the front door should lead with
what moved since yesterday and demote the prose. The brief is good writing; it
is not the most decision-relevant thing on the screen.

### 5.4 Opportunity has no representation anywhere

Every signal in the app is a degradation: threat, closure, lapse, interdiction,
overdue, LIMFAC. Nothing models an **opening** — an airfield returning to
service, a diplomatic clearance granted, a route reopening, a NOTAM cancelled,
weather clearing ahead of forecast.

"Postured to take advantage of them" is explicitly in the north star, and the
application has no vocabulary for advantage. This is a framing gap, not a
feature gap, and it touches every surface: most of the data needed is already
held, and only ever read for its negative.

---

## 6. Ranked recommendations

| # | Item | Effort | Why |
|---|---|---|---|
| 1 | **Crew/team state model** (§2) | L | The missing half of the north star |
| 2 | ~~**`lib/severity.ts`** — one vocabulary, one direction (§4.1)~~ **done** | S | Latent-bug class; the app's own icon rule |
| 3 | ~~**OE delta read** — what moved since you last looked (§3.1)~~ **done** | M | Four history tables already hold it |
| 4 | **Reconcile the two convergences** (§4.3) | S | My error; sitting side by side today |
| 5 | **Watch-pane hierarchy + collapse** (§5.1) | S | Wall of lists |
| 6 | **Glance leads with change** (§5.3) | M | Front door does not serve the verb |
| 7 | **Opportunity signals** (§5.4) | M | Framing gap across the whole app |
| 8 | **Rename the four "watch" surfaces** (§4.2) | S | Pure clarity |
| 9 | **Decision-log hit rate feeds indicator weighting** (§3.2) | M | Closes the learning loop properly |
| 10 | **Open-tracking beyond news** (§3.3) | S | Cheapest implicit signal, one surface only |

**If only three:** 2 (cheap, removes a latent-bug class), 3 (the north star's
own verb, and the data is already sitting there), 1 (the missing half of the
mission).
