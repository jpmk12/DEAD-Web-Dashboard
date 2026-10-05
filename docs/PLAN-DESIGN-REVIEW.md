# Plan — total design review, October 2026

> This is the plan for the review, not the review. It says what will be
> examined, with what evidence, in what order, and what comes out the other
> end. The findings will be written separately as `REVIEW-2026-10.md` in the
> format of `REVIEW.md` / `REVIEW-UX.md` (finding → verdict → ranked table →
> status line), so the record stays comparable.

> **The mission, restated in the owner's current words (2026-10-05):** the app
> covers *basic productivity* — email, calendar, tasks, curated news — so the
> operations officer of a C-17 squadron stays informed; and it *keeps alert to
> changes in the theater and the operational environment* so the need for
> mobility forces can be forecast. Two halves, as before; the role is now
> **operations officer**, and the review should read every surface against
> that job, not the commander's.

## 0. Why now, and what is different from the September reviews

`REVIEW.md` and `REVIEW-UX.md` (both 2026-09-29) are fully shipped except two
deferred code items (the physical `PreferencesDrawer` split, multi-user phase
2b). Since then the app gained the economy actor board, cyber/space warning,
the six-phase trend-learning layer, the family learning layer, crew state and
the demand horizon, the palette, push, the OE brief export, and this week's
mark-read and sign-in work. That is roughly a third of the codebase in five
weeks: 97 components, 219 library modules, 129 API routes, 99 test files, two
components over 1,400 lines and one over 3,400.

Three things make a *total* review the right next step rather than another
feature pass:

1. **Growth has outrun the map.** Nine tabs, four OSINT panes, six Preferences
   sections and a palette now reach the same facts by several doors. Nobody
   has asked, surface by surface, "does this still earn its place, and is it
   where the operator looks for it?"
2. **This week's bugs were all production-only, phone-shaped, and about
   state the app held rather than data it fetched**: a brief cached for a day
   from zero inputs; a primary sign-in silently re-established as the second
   account; a stale cached redirect replaying a rejected URL. None was visible
   from the sandbox, none was caught by 1,044 pure-function tests, and each
   presented as "the app is broken" with no diagnostic. The review needs a
   lens for *held state and its invalidation*, and for *what the operator
   sees when something fails*.
3. **The app now records its own use.** `surface_opens`, `anthropic_usage`,
   the brief's `generations`, the alert ids, the decision log and the
   trend-learning series exist. For the first time a review can be grounded
   in what is actually opened, what actually costs, and which sensors are
   actually alive, instead of in the reviewer's impression of the screen.

## 1. Scope

Everything the operator can reach, plus the things that run when nobody is
looking.

**Surfaces (the nine tabs and their panes).** Glance · News (feed, Threads,
newsletters, trends) · Calendar · Email (two accounts, triage, actions, File
under Family) · Family (School, Household, roster) · Docs (editor, synthesis
workflow, graph, lexicon) · OSINT (Watch = I&W + SITREP + Crisis map;
Regional; Feeds; Sources) · Economy (read, actor board, timeline, leverage,
coercion board, energy, chokepoints, regulatory) · Weather (locations, severe,
space weather).

**Cross-cutting systems.** Sign-in and the second Gmail account · the Morning
Brief (prefetch, cache, upgrade, modal, Glance card) · the floating assistant
and its OE context · the ⌘K palette · Preferences and the Mission Profile ·
alerts, push and the heartbeat · the learning layer (chronicity, convergence,
reactivation, decision log, calibration, attention gaps, trend verification) ·
AI spend controls · the capture extension (X, articles, LiveUAMap, MOFCOM,
alert polling) · multi-user (owner + crew).

**Out of scope.** Rewriting the data sources themselves (UCDP, ACLED, DAIP,
GDELT and the rest are reviewed for *how they are presented and how their
failure shows*, not for whether to replace them); the hosting platform; a
visual redesign for its own sake.

## 2. The lenses — the questions asked of every surface

Each surface is scored against all eight. A finding names the lens it fails.

1. **Job fit.** Which half of the mission does this serve, which *decision*
   of an operations officer does it inform, and how many seconds from open to
   answer? If it informs no decision, why is it on screen?
2. **Honesty.** The app's standing disciplines, audited rather than assumed:
   UNKNOWN is not clear; colour is earned; a date is never guessed; a dead
   feed is named; a learning-mode number is a tally, not a rate; the app
   scores only its own forecasts. Every place a surface *could* imply more
   certainty than it has is a finding.
3. **Attention.** What is on screen versus what is opened (`surface_opens`,
   per surface, last 30 days). The Christmas-tree test: how many things are
   lit at once on a normal day, and could the operator tell which one changed?
4. **Phone first.** The operator travels and this week's bugs were all found
   on a phone. Each surface is walked on a 390-px viewport, in Safari and as
   the installed app: can it be read, can it be operated with a thumb, does
   it survive a backgrounded tab and a stale session?
5. **Held state.** Every cache, cookie, localStorage key and day-keyed row:
   what fills it, what invalidates it, what the operator sees when it is
   stale or wrong, and whether a bad value can lock in (the brief did). The
   output of this lens is a table, not prose.
6. **Failure visibility.** For every fetch a surface makes: when it fails,
   does the surface say so, where, and does it say *why*? When a model call
   fails, does the surface degrade to its deterministic half? Is there a
   diagnostic route, and does it run from production?
7. **Cost.** `anthropic_usage` by route for 30 days. What pays, how often, on
   what trigger, and what the operator got for it. Anything that pays on page
   load or on a poll is a finding by rule.
8. **Cohesion and code.** One home per rule, one word per concept, one door
   per fact. File size, pure-versus-impure split, which routes have no test
   at any level, and whether the CLAUDE.md note for a feature still matches
   the code.

## 3. Evidence to gather before judging anything

The review must start from data. These pulls happen first, in one session,
and are attached to the findings document as an appendix.

**From production (owner-only diag and summary routes, run from the deployed
app, not the sandbox):**
- `surface_opens` grouped by surface and item, 30 days — what is looked at.
- Preferences → AI Controls 30-day breakdown by route and user — what pays.
- `briefing_cache` rows for the last 14 days: `inputs`, `generations`,
  `isSectionless` — how often the brief was thin and whether the upgrade
  rule fired.
- The sensor-health diag routes (`/api/spectrum?diag=1`,
  `/api/markets/economic-warfare?diag=1`, `/api/markets/regulatory?diag=1`,
  `/api/osint/map-diag`, `/api/osint/crisis-diag`, `/api/sitrep/infra-diag`):
  which feeds are live in production today. A dead feed that renders as
  "quiet" is the single most dangerous class of finding.
- `alerts` fired and push deliveries in 30 days; the capture extension's
  poll cadence as seen from `/api/alerts/check` hits.
- Trend-learning cold-start status: which series have passed their floors
  (weekday baselines, demand skill, TAF pairs, KEV cadence, 90-day highs).
- `warning_decisions`: entries, scored, ambiguous share, per board.
- Error log scan for the week: route 5xx counts, model JSON-parse failures,
  Gmail 401s.

**From the operator (the part only you can supply):**
- A phone walkthrough of one real morning, start to finish, as screenshots
  or a screen recording, with a note at every point you hesitated, scrolled
  past something, or left the app to do something it should have done.
- Your actual day as operations officer: the decisions you make, the
  artefacts you produce (schedules, taskers, slides, emails), where you make
  them today, and which of those the app could hold or feed. The app models
  crew *counts*; it does not model missions, taskings, aircraft status or
  the flying schedule. Whether it should is the biggest open question in
  the professional half and only you can bound it.
- The surfaces you never open, and why. The `surface_opens` data will say
  *that*; you say *why*.
- The three moments in the last month the app was most useful, and the three
  it let you down.

## 4. Scripted scenarios

Walked on desktop and phone, timed, with the lens checklist. Each scenario
is a real sequence the job produces, not a feature tour.

**Professional half**
- *Morning in theater.* Open the app at 0600 local on TDY in a Level-4
  country. What is known in 60 seconds: posture, what changed overnight,
  today's schedule, the brief, demand direction. What had to be tapped.
- *A base goes RED.* A watched base flips during the day. Where does it show
  first (push, Glance tile, OE delta, map, SITREP strip, assistant), is it
  the same story on each, and what does the operator do next from each?
- *A tasking is coming.* An I&W board steps up and the demand horizon says
  RISE for a command. Can the operator get from that to "which crews, which
  aircraft, which airfields" without leaving the app? (Expected answer: no.
  The scenario measures how far the app gets and where it hands off.)
- *A strait closes.* Chokepoint act reported; what does the Economy tab,
  the I&W board, the map and the brief each say, and do they agree?
- *Brief someone.* Produce the one-page OE brief and a SITREP export and
  hand them to a reader with no login. What is missing from the page that
  the operator had to add by hand?

**Personal half**
- *Inbox at 2200.* Two accounts, triage, actions to tasks, file under
  Family. Does anything the Family digest later found have been visible
  here and missed?
- *The buried form.* A school newsletter mentions a form due in six weeks.
  Trace it: digest → stored deadline → Calendar → brief week-ahead → snooze →
  lapse. Is the state honest at every stop?
- *The bill that stopped.* A biller falls silent. When does the app say so,
  and is it right?
- *Weekly sign-in.* The refresh token lapses on the phone. Sign back in. Is
  it the right account, is the second account still attached, is anything
  lost?

## 5. Per-surface agenda — what the review will look at first

These are starting hypotheses from reading the code and the shipped record.
They are to be confirmed or refuted by the evidence in §3, not acted on.

**Glance.** Nine stacked blocks (clocks → brief → status row → OE delta →
Needs You Now → demand → Global Reach → two-column body). On a phone that is
several screens. Hypotheses: the fold is wrong for the job (the first screen
should be *what changed and what needs me*, which is blocks 3–5, not clocks
and prose); Global Reach Watch and the two-column body duplicate the News
and OSINT tabs; the brief card and the modal disagree about what a brief is.
Also: the brief fixes this week were the third round on the same symptom —
the review should ask whether a day-cached prose brief is the right artefact
for a traveller at all, or whether the deterministic blocks (OE delta,
demand, status) *are* the brief and the prose is a footnote.

**News.** Three sub-surfaces (feed, Threads, newsletters) plus trends. The
Threads analysis is the most expensive call in the app; the review should
ask what decision it informs that the OSINT feed and the brief do not, and
measure its opens against its cost. Newsletters are also an I&W input — is
the News tab their right home?

**Calendar.** Now carries family deadlines and bills alongside events. Check
that the honesty rules survive the merge (an unanchored date must not
render as a dated event) and whether the operator's *flying* schedule, the
thing the job revolves around, has any representation.

**Email.** Two accounts, now with the primary address shown and the
same-account guard. Review the triage model's cost and precision against
the operator's own VIP/mute list; whether the "actions" extraction feeds
Tasks reliably; and whether File under Family is discoverable.

**Family.** Owner-only, model-gated, the most sensitive data in the app.
Review: the roster's cost to maintain versus the proposal/discovery
pipeline built to reduce it; the mark-read rule now live; whether Household
has enough history yet to make any claim, and what it shows while it does
not. Check the write boundary (the only calendar write) still re-validates.

**Docs.** The synthesis workflow (compose, split, typed links, collections,
graph, lexicon, thread timelines) is a knowledge system with a large
surface. The review's question is blunt: how many docs exist, how many have
links, how often is Graph or Lexicon opened? If the answer is "few", the
feature set should be folded, not polished.

**OSINT › Watch.** The real second home. Hypotheses: the I&W strip and the
SITREP strip have become the operator's primary instruments and belong
above the fold *everywhere*, including Glance; the Crisis map's layer count
(twenty-plus) needs the same "colour is earned" discipline as the boards —
a layer nobody turns on is a cost; the Forming section (convergence,
reactivation) is correctly folded but may be unread.

**OSINT › Regional.** The per-country dossier is deep (incidents, news,
advisory detail, holidays, health, digital) and owner-fetched on open.
Review open counts per country; whether the AI SITREP is used; whether the
rail's grouping (AOIs → own force → COCOM) matches how the operator thinks.

**OSINT › Feeds / Sources.** Feeds is one list with a filter; Sources holds
the watchlist recommendations and configuration. Review whether Sources
belongs in Preferences, and whether Feeds and the News tab are two views of
one thing.

**Economy.** The newest and densest tab: read, tiles, timeline, leverage,
coercion board, energy, chokepoints, regulatory, news filter. Review against
the actor north star: can the operator read the board in 30 seconds; are the
latency rules (pending stubs, polling) holding in production; what does the
tab show on a quiet day, and is quiet distinguishable from dead.

**Weather.** Location cards, severe weather, space weather → ops. Review
its role now that SITREP, Force Protection and the map all carry weather:
is a standalone tab still earning its place, or is it the Glance travel
line plus a SITREP card?

**Preferences and the Mission Profile.** The sectioned model works; the
file is 3,453 lines. Review completeness of the profile as the single
declaration (what still has to be configured elsewhere), the crew-state
editor's cadence of use, and whether team config and personal config are
visibly distinct to a crew member.

**Brief, assistant, palette, push.** The four doors that cut across tabs.
Review which one the operator actually uses to move (palette opens versus
tab taps), whether the assistant's OE context changes what it is asked, and
whether push fires for the right four predicates or too few or too many.

**Auth and multi-user.** This week's fixes are deployed and unverified in
production. The review re-tests the weekly re-sign-in on the phone, the
second-account add, and a crew member's view (what they see that is the
owner's, what they cannot change and should).

**The capture extension.** Four capture kinds, a bearer token, alert
polling and the heartbeat all ride it. Review what it actually captured in
30 days, whether the selectors still match the live sites, and whether a
machine without the extension (the operator's phone) loses the heartbeat.

## 6. Candidate themes to evaluate — hypotheses, not decisions

Each is a question the findings document will answer with Keep / Fix / Cut /
Build. None is approved by appearing here.

1. **Information architecture.** Nine tabs may be three modes: *Me*
   (Glance, Calendar, Email, Family), *World* (News, OSINT, Economy,
   Weather), *Work* (Docs, Preferences). Or fewer tabs with Weather folded
   into OSINT and Glance, and Economy as an OSINT pane. The evidence is the
   open counts and the phone walkthrough.
2. **The missing object: the mission.** The app models the world and the
   crews, not the flying. A minimal "lines" object (mission, date, airframe,
   crew qual, route, status) would let demand, crews, posture and NOTAMs
   converge on the thing the operations officer actually schedules. This is
   the largest possible build and the one most dependent on §3's operator
   interview; the review should bound it, not design it.
3. **Openings as first-class signals** (REVIEW §5.4, still open). A NOTAM
   cancelled, a route reopened, a clearance granted, a posture eased. The
   sensors report only disappearances of negatives. Review which sources
   can report an opening directly.
4. **Held-state invalidation as a system.** Every cache and day-key in one
   registry with its fill rule, its invalidation rule and its failure
   display, the way `sensorKeys.ts` registers every daily series. The brief,
   the auth cookies and the secondary redirect each failed this week for
   lack of exactly this.
5. **Failure made visible.** A single "sources" strip or page: every feed,
   live or dead, last success, and the surface it feeds. Several diag routes
   exist; none is a place the operator looks.
6. **Notification policy.** Push exists with four predicates. Review which
   events deserve interruption on a phone in theater, which deserve a
   badge, and which deserve nothing until the next open.
7. **Degraded mode for travel.** The service worker caches nothing, by
   design, because a stale dashboard that looks live is worse than a login
   page. Revisit whether a clearly-stamped read-only snapshot (the OE brief
   export, automatically refreshed) is the right offline artefact for a
   twelve-hour flight.
8. **Code health.** The `PreferencesDrawer` split; `CrisisMap` and
   `GlanceTab` at 1,400+ lines; route-level tests (there are none — every
   test is a pure module); a contract test for each cache's invalidation
   rule; CLAUDE.md pruning (it is now the size of a small book, and its
   job is to stop re-learning, not to narrate).
9. **Multi-user phase 2b**, deferred twice. Review whether a crew member
   actually uses the app yet; if not, it stays deferred with a reason.
10. **Cost ceiling.** A per-day budget per feature in AI Controls, enforced
    at the call site, so a regression like the brief's cannot become a
    spend problem before it is noticed.

## 7. Method and sequence

| Phase | What | Who | Output |
|---|---|---|---|
| A | Evidence pull (§3, production half); build any missing read route needed to see it | me | appendix tables in the findings doc |
| B | Operator inputs (§3, operator half) and scripted scenarios (§4) on desktop and phone | you, with a checklist from me | annotated screenshots, timings, hesitation notes |
| C | Surface-by-surface findings against the eight lenses (§5), each with a Keep / Fix / Cut / Build verdict and the evidence it rests on | me | `docs/REVIEW-2026-10.md` |
| D | Theme decisions (§6) — the handful that change the shape of the app, each with a mockup in `docs/mockups/` where layout is at stake | you decide, I propose | decisions recorded in the findings doc |
| E | Ranked backlog: size (S/M/L), half served, lens failed, dependency; same table format as the prior reviews so status can be tracked in place | me | the ranked table |
| F | Build in phases as before, one commit per phase, verification loop unchanged, CLAUDE.md note per feature, status line updated in the findings doc | me | shipped work |

Phases A and B run in parallel. C waits for both. D is a conversation, not
a document. E and F follow the pattern that shipped the last two reviews.

**Decisions to take before Phase C** (they change what the review measures):
- Is the north star text updated to "operations officer"? It changes the
  job-fit lens for every surface.
- Is the mission object (§6.2) in scope for *bounding* in this review, or
  explicitly parked? It is the one theme that could dominate everything else.
- Is information architecture (§6.1) open for change, or are the nine tabs
  a constraint? The phone walkthrough is designed differently depending on
  the answer.

## 8. Ground rules the review does not reopen

Carried from the shipped record; a finding that contradicts one must say so
and argue it.

- No new npm dependency that brings esbuild; `grep -c esbuild
  package-lock.json` stays 0. Tests run via `npx vitest`, never installed.
- Nothing pays a model call on page load or on a poll. Every call is
  attributed to a user. The ledger is the source of truth.
- UNKNOWN is never rendered as clear. Colour is earned. A date is never
  guessed. A learning-mode series shows a tally, not a rate. The app scores
  its own forecasts, never the analyst's calls.
- Family data is owner-only; the roster is the query; only sender discovery
  looks wider, on a button, at headers.
- No server-side X credentials or scraping; captures happen in the
  operator's own browser.
- Space weather is environment, never an I&W level. KEV is read against
  declared vendors only. Every input is passive.
- The service worker caches nothing (unless §6.7 concludes otherwise, and
  then only a stamped snapshot).
- Pure logic lives in `lib/`, is client-safe where imported by components,
  and is tested; server-only modules say so.

## 9. What a good outcome looks like

At the end of Phase E there is one document that says, for every surface,
whether it stays, changes, goes or grows, with the evidence for each call;
a short list of shape-changing decisions the owner has taken; and a ranked
backlog whose top five items each serve a named decision of an operations
officer or a named hour of the operator's personal day. The app should come
out of it with fewer things on screen, each of them more trusted, and with
a map of its own held state so that this week's class of bug has a place to
be caught before a phone finds it.
