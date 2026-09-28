# Experience review — layout, interaction, and what to build next

> Companion to `REVIEW.md` (north-star fit and cohesion). This one is about the
> *experience*: how the app is laid out, how it is operated, and which features
> would take each half of the mission to the next level.
>
> **The mission has two halves.** Professional: understand the connections
> driving the world so a C-17 squadron commander can accurately predict the
> needs of the force. Personal: save time and take care of the family. The app
> serves both, and several findings below are one fix that serves both.

Surveyed 2026-09-28. 83 components (27,403 lines), 9 tabs, 113 routes.

---

## 1. What the survey measured

| Measure | Finding |
|---|---|
| Largest component | `PreferencesDrawer.tsx` — **3,408 lines**, 2.4× the next file |
| Mobile-aware components | **2 of 83** (both in Docs) |
| Tab bar overflow handling | **none** — 9 uppercase tabs in a plain flex row |
| Installability (manifest / service worker) | **none**; `public/` holds one HTML file |
| Keyboard shortcuts | **1** (⌘K → quick capture) |
| Components with their own error state | **23**, with **54** distinct "failed / could not" strings |
| Shared feedback components | **1** (`SessionExpiredBanner`) |
| `aria-*` attributes / focus-ring rules | **18 / 1** across the whole app |
| Surfaces with export | Threads, SITREP, Docs — **not** I&W, OE delta, decision log, posture |
| What the assistant can see | calendar, tasks, articles, newsletters — **not** the active tab, selected entity, or any OE state |

---

## 2. Layout and navigation

### 2.1 The app does not work on a phone, and the commander travels
The morning brief resolves its timezone from the device *because* the user
opens it from other zones. Yet: the tab bar has no wrap or scroll, so nine
tabs clip on a phone; two components in the entire app consult `useIsMobile`;
there is no manifest, no service worker, no home-screen icon; and the only
alerting path is a **Chrome extension**, which cannot exist on a phone. The
app's most time-critical outputs — a base going red, an I&W board moving, a
family deadline lapsing — cannot reach the user unless a desktop browser
happens to be open.

**Fix, in order:** (1) a scrollable tab bar with a compact mode — icons only
below `sm`, with the badge kept; (2) a PWA manifest + minimal service worker
(app shell only — the data must never be served stale from a cache, the
"UNKNOWN is not clear" rule applies to cache age too); (3) web push driven by
the existing `/api/alerts/check`, which was built transport-agnostic for
exactly this and needs no server changes beyond a subscription table.

### 2.2 Preferences is a 3,408-line flat scroll
Every "declare then derive" feature (Mission Profile, Force Protection, feeds,
ACLED, AI controls, SITREP bases, X token, family roster, timezone…) lands
another panel in one file. The detected section structure is effectively one
header. Two consequences: it is the hardest file in the app to change safely,
and the user cannot find a setting without scrolling past every other one.

**Fix:** a left-rail settings index (Profile · Mission · Sources · AI · Family ·
Diagnostics), one file per section, URL-addressable (`?prefs=sources`) so a
recommendation card can deep-link to the setting it changes. This is also the
cohesion fix for §3.4 below.

### 2.3 The Watch pane is a wall (carried from REVIEW §5.1)
Four ranked lists before the map, three inside it. Needs an explicit
hierarchy — *decide* → *changed* → *picture* — with the lower cards collapsed
by default. The OE delta now exists and is the right "changed" card; the
map's own convergence strip should be deleted in favour of the cross-surface
card (REVIEW §4.3).

### 2.4 Glance: the morning brief is still the hero
The OE delta now leads, which is the right first step. But the brief remains
a large green hero block of day-cached prose. For a "see changes" north star
the hero should be a **status row** — posture / SITREP / I&W / family counts,
each a live tile that deep-links — with the brief demoted to a collapsible
below it. The LED-tile pattern already exists on the Watch pane; reuse it.

---

## 3. Interaction

### 3.1 No command palette — the biggest single time-saver available
The app has a docs search grammar, a titles index, a base list, a country
rail, nine tabs and an I&W problem list, and **one keyboard shortcut**. A ⌘K
palette that jumps to "KWRI SITREP", "CENTCOM · Iran board", "Emma's
deadlines", a doc title, or a Preferences section — with quick capture as one
action inside it — reuses endpoints that already exist (`/documents/titles`,
`/sitrep/bases`, `/force-protection`, `/warning`). Serves both halves of the
mission equally.

### 3.2 Feedback is inconsistent
23 components implement their own error state; 54 different copy variants;
success is usually silent. One shared toast (bottom, non-blocking, with the
same three tones the app already uses) and a single `useFeedback()` hook
would replace all of it and make "did that save?" answerable everywhere.

### 3.3 Keyboard focus is invisible
One `focus-visible` rule in the codebase. On the locked-down machines from
earlier today — where the fix for sign-in was "make it work without client
JavaScript" — a user tabbing through controls cannot see where they are. A
global `:focus-visible` outline in `globals.css` plus `aria-label` on
icon-only buttons is a one-hour fix with outsized value for that environment.

### 3.4 Recommendations live far from the settings they change
Watchlist suggestions sit on the OSINT Sources pane; sender discovery in
Household; but the settings they modify (watchlist, roster) live in the
Preferences drawer. Each recommendation card should deep-link to its setting
(needs §2.2), and each setting should show its pending recommendations.

### 3.5 The assistant cannot see the operational picture
`ChatPanel` receives calendar, tasks, articles and newsletters. It does not
receive the active tab, the selected base/country/problem, or any I&W,
posture, SITREP, chokepoint, or family state. So "why is Al Udeid amber?" or
"what's due while I'm in Stuttgart?" cannot be answered by the one component
that is on every tab. See §4.1 — this is the highest-value feature in the
professional half and it is mostly plumbing.

---

## 4. The professional half — predicting the needs of the force

### 4.1 A context-aware assistant ("ask about what I'm looking at")
Pass the assistant a compact **OE context**: active tab, selected entity, and
the current derived state — I&W levels + drivers, posture composites +
chronicity, SITREP LEDs + LIMFACs, chokepoint reads, the OE delta, and (on
Family) tracked deadlines and trip conflicts. All of it is already computed
and cached; none of it is sent to the model today. Attribute the call, gate it
on the `chat` feature, and cap the context to keep spend flat. This is the
"connections" feature: it lets the user ask across surfaces that today only
the convergence card joins.

### 4.2 A demand horizon — the forecast the north star asks for
The app derives *current* mobility demand (`/api/crisis-read`, HADR scoring,
the I&W divergence sensor) but projects nothing. "Accurately predicting the
needs of my forces" wants a **7-day demand outlook per AOR**: I&W trajectory
(deteriorating boards), disaster HADR scores with recency, NEO posture, and
chokepoint interdiction reads, rolled into a deterministic "demand likely to
rise / hold / fall" per command with drivers listed. No model call — the
inputs are the sensors the board already runs — and it is exactly the sentence
the crew-state model (REVIEW §2) needs on the other side of the equation.

### 4.3 Export the briefable artefacts
The I&W board, the OE delta and the decision log are what a commander briefs
upward, and none exports. Reuse the SITREP HTML exporter's discipline (zero
JavaScript, zero external resources, "SNAPSHOT — NOT LIVE" stamp, every value
escaped). A one-page "OE brief" combining the OE delta + I&W strip + posture
board is the natural first artefact.

### 4.4 Team state (REVIEW §2 — restated, not repeated)
Still the largest gap. Needs a design conversation before building.

### 4.5 Finish the economic-warfare sequence
C (Federal Register tariffs/sanctions — the missing data class), D
(chokepoint indicators on the AOI boards), E (AIS transit counts — blocked on
`AISSTREAM_API_KEY`).

---

## 5. The personal half — time and family

### 5.1 Bills and deadlines on the Calendar
The Calendar tab shows events, tasks, keep-in-touch and trips. It does not
show the **due dates the app already tracks** — family deadlines
(`family_deadlines.due_iso`), bill due dates (`household_bills.due_date`),
document expiries and expected-document by-dates. Rendering them as a second
layer on the existing calendar (toggle, muted colour, click-through to the
Family tab) turns four lists into one week view, and it is read-only over data
already held.

### 5.2 A "week ahead" family block in the Morning Brief
The brief already fetches SITREP LEDs live at open, deliberately outside the
cached AI text. The same pattern gives it a **family week-ahead block**:
deadlines due in 7 days, anything lapsed, trip conflicts, expected documents
overdue, account jeopardy. Deterministic, no tokens, and it means the family
half is seen every morning without opening the tab.

### 5.3 Defer, not just done
Tracked deadlines can be marked done or "not mine". Real life has a third
answer: *not now*. A snooze (to a date, or "until I'm back" using the trip
end date) keeps the record honest — it is still open — without the row
nagging daily. The lapsed rule stays: a snoozed deadline that passes its date
still lapses.

### 5.4 Family roster: people, not just senders
The roster knows children by name but the digest is organised by sender. A
per-person view — Emma: 2 deadlines, 1 activity signup, next conference —
already has the data (`personId` on deadlines and senders); it needs the
grouping and a small header card per person.

### 5.5 Close the discovery loop on the school side
Sender discovery now lands on the Household pane and proposes school and
activity senders too. The school pane should surface the same proposals
where the roster is edited, so a new activity is one tap away from being
tracked on the surface where its deadlines will appear.

---

## 6. Ranked

| # | Item | Effort | Serves |
|---|---|---|---|
| 1 | **Phone: scrollable tab bar + PWA shell + web push** (§2.1) | M | both — the outputs can finally reach you |
| 2 | **Command palette** (§3.1) | M | both — largest time saver |
| 3 | **Context-aware assistant** (§4.1) | M | professional — the "connections" feature |
| 4 | **Bills & deadlines on the Calendar** (§5.1) | S | personal |
| 5 | **Family week-ahead in the brief** (§5.2) | S | personal |
| 6 | **Shared toast + focus-visible + aria** (§3.2, §3.3) | S | both — and the secure-machine case |
| 7 | **Demand horizon** (§4.2) | M | professional — the forecast the north star names |
| 8 | **Preferences → sectioned settings** (§2.2) | L | both — unblocks §3.4 |
| 9 | **Export the OE brief** (§4.3) | M | professional |
| 10 | **Watch-pane hierarchy + remove the map's convergence strip** (§2.3) | S | professional |
| 11 | **Glance status row as hero** (§2.4) | M | both |
| 12 | Snooze, per-person view, school-side discovery (§5.3–5.5) | S each | personal |
| 13 | Team state (REVIEW §2) | L | professional — needs design first |

**If only three:** 1, 2, 3. Together they change the app from "a desktop I
sit down at" into "the thing that tells me, wherever I am, and answers when I
ask."
