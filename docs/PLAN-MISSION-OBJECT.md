# Plan — bounding the mission object

Status: DECIDED and BUILT (phases 2–3), 2026-10-27. §2 was answered the
same day and the schema in §3 is the one that shipped. The original
questions are kept with the answers beside them, because the answers are
the bound: a line is a Zulu day, an airframe, the fields in order and a
status, and nothing finer — the operator's own words were "I don't want to
actually put real flight data in here. I want to keep it high level."

## Answers (2026-10-27)

| # | Question | Answer | What it fixed |
|---|---|---|---|
| 1 | Unit of record | **by Julian / Zulu day** | one row = one Zulu day (`day` YYYY-MM-DD); the JD is derived for display, never stored |
| 2 | Fields | **a series of fields of interest** | `fields` = ordered ICAO list, up to 8; a turn keeps its repeat |
| 3 | Airframe | **C-17, C-130, KC-135, KC-46** | `LINE_AIRFRAMES`, the four and no other |
| 4 | Crew | **not at this level of detail** | NO crew column; the crew-state join is dropped |
| 5 | Status | **planned and execution** | `planned \| execution`, two states, no slip flag |
| 6 | Horizon | **4 days** | `LINE_HORIZON_DAYS` 4, today included; a line beyond it exists but is not read |
| 7 | Source | **no real flight data — keep it high level** | no label, no note, no times, no tails, no callsigns, no loads; the validator REFUSES every extra key and every token shaped like one |
| 8 | Who | (default) | crew-maintained, attributed by email, the `crew_state` model |
| 9 | Never held | (default, strengthened by 7) | tails, callsigns, loads, times, free text — refused at the write boundary, by name |

What shipped: `lib/missionLines.ts` (PURE: vocabulary, validator, day
maths), `lib/lineRead.ts` (PURE: the join), `lib/missionLineStore.ts` +
`mission_lines`, `lib/lineReadAssemble.ts` (server, bounded, 5-min cache),
`/api/mission-lines`, the Glance **Lines** strip under the status row, a
section in the Ask pack, a block in the Morning Brief prompt and a table in
the OE brief export. The sections below are the original proposal; where
they say "crew complement", "label" or "note", the answers above override.

**Lines and the demand horizon (decided the same day).** Asked whether
lines should be part of the 7-day demand on Glance: no — beside it, never
inside its score. The horizon forecasts and is scored against observed
lift; a line is a commitment, and feeding it in would make the forecast
verify because it was told. The relationship is carried by the crews:
forecast × committed lines × available crews. Built: a lines chip per
command on the demand card (absent when none), lines as a second trigger
of the crews mismatch (declared against thin crews; more lines than
available crews), and the command's outlook as context on the line. Not
built, by design, until a month of lines exists: lines as a second
VERIFICATION target for the horizon. An unused feature leaves the board
exactly as it was — every join is absent, not zero, when nothing is
declared.

## 0. Why this is the largest lever left

The dashboard models the world (posture, I&W boards, SITREPs, straits,
spectrum) and the squadron (crew counts against demand). It does not model
the flying. Every sensor answers "what is the environment doing"; none can
answer "what does that mean for Tuesday's line to OJAQ", because the app
has never been told there is a line to OJAQ on Tuesday.

The north star is predicting the needs of the force. The mission object is
what turns a world picture into a need: a lift on a date through named
fields is the thing demand, crews, posture, NOTAMs, TAF, lunar light, strait
reads and lift chatter all converge on. Without it every surface reports in
the abstract ("CENTCOM demand likely to RISE"); with it the same surfaces
can say "two of your five lines this week route through a field reading
PMC under forecast IFR, and the crew-rest window on line 3 ends before the
NOTAM closure lifts".

## 1. The bound: what a mission object is NOT

Stated first, because the failure mode is obvious. This app must not become
a scheduling system, a flight-planning tool or a mission-management
product. Those exist, are authoritative, and are classified or controlled
in ways this open-source dashboard is not. The rules that bound it:

- **It is a REFERENCE to a line, not the line.** Enough to join the world
  picture to it: a date, the fields it touches, the airframe class, the
  crew qualification it needs, a status. Never the full itinerary, never a
  load, never a callsign, never a tail, never a passenger. The record must
  be something the operator is comfortable typing into an open-source app
  on a personal account.
- **It is DECLARED, never derived.** The app does not infer lines from
  ADS-B, chatter or the demand horizon. The operator (or the crew) types
  them, the same way crew counts are declared. A line the app guessed would
  be a claim about the schedule the app cannot stand behind.
- **It never changes a level.** A line is a lens, not a sensor. Posture,
  LEDs and board levels are what they are; the line selects which of them
  matter today and says so. The "colour is earned" rule holds: a line
  through a red field is a red LINE READ, not a redder field.
- **Counts and classes, not people.** The crew-state rule applies: a line
  needs a qualification level, never a name.
- **Planning-grade, stated.** Everything the app joins to a line is
  advisory (TAF, lunar, NOTAM windows, runway class). The line read says
  so on every surface, the way the reach rings do.

## 2. The conversation first — what a line on your schedule looks like

The record cannot be designed from the outside. These are the questions,
each with the default the plan assumes if the answer is "whatever is
simplest". Answer in the margin; the schema in §3 changes accordingly.

1. **Unit of record.** Is a "line" one sortie, one mission (several legs
   over several days), or one crew-day? Default: a MISSION with a start
   date, an end date and an ordered list of fields; legs are implied by the
   order and not stored separately.
2. **Fields.** Do you think in ICAOs, in base names, or in both? Default:
   ICAO, resolved through the same door the Track picker uses, so a line
   can name any field the app can already place.
3. **Airframe.** C-17 only, or does the squadron's picture include C-130 /
   KC lines you also need to see? Default: an airframe class from the
   existing `AIRFRAMES` list (the reach rings), C-17 preselected.
4. **Crew.** Which qualification does a line consume — the `crew_state`
   quals (IP / AC / FP / LM) as they stand, or a crew COMPLEMENT (one AC,
   one FP, one LM)? Default: a complement expressed in the existing quals,
   editable per line.
5. **Status vocabulary.** What states does a line move through in your
   world? Default: `planned → alerted → flying → recovered → cancelled`,
   with `slipped` as a flag rather than a state (a slip keeps the line and
   moves the date).
6. **Horizon.** How far ahead is the schedule real? Default: lines are
   shown 14 days out; beyond that they exist but are not read.
7. **Source.** Will you type lines in, or paste something (a published
   schedule, a text, a spreadsheet row)? Default: typed, with a paste box
   that reads one line per row in a fixed order — never an upload of a
   scheduling product's export.
8. **Who.** Owner-only, or crew-maintained like crew counts and LIMFACs?
   Default: crew-maintained, attributed by email, the `sitrep_limfacs`
   model.
9. **What must the app NEVER hold.** Say it explicitly so the schema can
   refuse it at the write boundary (the `/api/family/event` rule). Default
   refusals: tail numbers, callsigns, passenger or cargo descriptions,
   times finer than a day, free-text longer than one line.

## 3. The minimal record (default answers)

```
mission_lines
  id            VARCHAR(64)   PK
  label         VARCHAR(80)   what you call it ("Tue OJAQ turn")
  airframe      VARCHAR(16)   key into AIRFRAMES
  start_day     VARCHAR(10)   YYYY-MM-DD, the operator's calendar day
  end_day       VARCHAR(10)   YYYY-MM-DD (= start_day for a turn)
  fields        JSON          ordered ICAO list, resolved at write
  crew          JSON          { qual: count } in crew_state quals
  status        VARCHAR(16)   planned | alerted | flying | recovered | cancelled
  slipped_from  VARCHAR(10)   NULL, or the day it was first planned for
  note          VARCHAR(200)  one line, optional
  updated_by    VARCHAR(255)
  updated_at    DATETIME(3)
```

Nothing else. `lib/missionLines.ts` (PURE, tested) holds the vocabulary,
the validator (the refusals in §2.9 are REGEX refusals at the boundary —
anything that looks like a tail or a callsign is rejected with the reason)
and the day arithmetic; `lib/missionLineStore.ts` the rows;
`/api/mission-lines` the CRUD; the Mission Profile is not touched.

## 4. What converges on a line — the join, surface by surface

Every row below is a PURE join over caches the app already keeps. No new
fetch, no model call, no new sensor. The line read is `lib/lineRead.ts`:
one function, one line in, one `LineRead` out, tested on fixtures.

| Existing surface | What it contributes to a line | Rule |
|---|---|---|
| SITREP summaries (`/api/sitrep/summary`) | the five LEDs of every field on the line that has a slot; UNKNOWN for a field without one | worst LED across the line's fields, named by field; a field with no slot reads UNKNOWN "★ for a SITREP", never green |
| Force posture (`forceProtectionCached`) | composite + chronicity per field / host country | a RED field or country on the line is the line's lead driver |
| NOTAM closure windows (`closureWindows`, `fieldClosureState`) | runway / field closures that fall INSIDE the line's days | an in-effect or scheduled closure on a line day is a CCIR-class line driver; a closure outside the days is noise |
| TAF timeline (`tafTimeline`) | forecast category over the first 24 h at the departure field | advisory; "IFR forecast" names the window |
| Lunar (`lunarNight`) | tonight's budget at the destination for a night line | advisory; the light-data line as on the airfield cards |
| Crew state (`crewState`) | the line's complement against today's availability | a complement that exceeds availability is a mismatch; stale counts say "confirm" |
| Demand horizon | the command the line enters, its 7-d outlook | context, not a driver |
| Chokepoint / MARAD / UKMTO reads | only when a field sits inside a strait's radius | a declared threat on the route is a driver |
| Lift chatter | chatter naming a field on the line | corroboration only, "reported, not observed" |
| Runway capability (OurAirports) | the airframe class vs the longest open runway at every field | a field below the airframe's class is a hard driver, stated once |

Disciplines that hold in the join: UNKNOWN is a value, never green; a dead
feed names itself on the line; nothing is guessed about a field the app
cannot place (the line still saves, with the field marked unresolved).

## 5. Surfaces

- **Glance — "Lines" strip** under the status row: the next 7 days, one
  row per line: label · days · fields · worst driver · crew fit. A line
  with no driver reads quiet, with "absence of signal, not evidence of
  calm" where a feed was dead.
- **The line room** (a page in the existing room drawer, kind `line`): the
  record, the per-field LEDs and drivers, the closure timeline clipped to
  the line's days, TAF, lunar, the crew fit, and every door (the field's
  SITREP, the country room, the board).
- **The OE brief export** gains a Lines table; the Ask pack gains a "your
  lines this week" section so "is Tuesday's OJAQ line at risk" has an
  answer; the Morning Brief prompt gets the week's lines as context (one
  line each, no more).
- **The command board** marks a command with a line this week.

## 6. What is deliberately NOT in phase 1

Reading a schedule from any external system; times finer than a day;
routing or fuel; a per-line map; alerts (the alert predicates can read the
line driver in a later phase, once the join has been watched for a few
weeks); verification (a `line_read_daily` series that scores whether a
line's driver predicted a slip or a cancel is the obvious phase 3 — the
demand-horizon pattern — but needs a month of real lines first).

## 7. Phases

1. **Conversation** (§2) — one exchange, then the schema is fixed.
2. **Record + room**: `lib/missionLines.ts`, store, route, the editor in
   the line room, the Glance strip. Verifiable in the harness without a
   database for the UI, and in unit tests for the validator.
3. **The join**: `lib/lineRead.ts` and its fixtures; the per-field drivers
   on the room and the strip; the Ask pack and brief sections.
4. **Watch for a month**, then decide on alerts and verification.

## 8. Decisions needed from you

The nine questions in §2. If every answer is "default", say so in one line
and phase 2 can start.
