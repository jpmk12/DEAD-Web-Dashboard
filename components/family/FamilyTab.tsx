"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FamilyDigest } from "@/lib/family";
import type { DeadlineView } from "@/lib/familyDeadlines";
import type { TripConflict } from "@/lib/familyTripConflict";
import { toast } from "@/lib/feedback";
import type { FamilyPerson, FamilyProfile } from "@/lib/familyProfile";
import type { ProposedEvent } from "@/lib/familyDates";
import FamilyRosterEditor from "@/components/family/FamilyRosterEditor";
import HouseholdPane from "@/components/family/HouseholdPane";
import SenderDiscoveryCard from "@/components/family/SenderDiscoveryCard";
import ProposalsCard from "@/components/family/ProposalsCard";

// The Family tab: school and household mail reported as obligations with dates
// rather than as messages. The deadline is the unit of this interface — an
// inbox already shows you unread mail; what it cannot show you is that the
// exclusion notice was one sentence inside a newsletter about spirit week.

const PERSON_TINT = [
  { chip: "text-violet-300 bg-violet-500/15 border-violet-500/35", bar: "border-l-violet-400", av: "bg-violet-500/15 text-violet-300 border-violet-500/40" },
  { chip: "text-sky-300 bg-sky-500/15 border-sky-500/35", bar: "border-l-sky-400", av: "bg-sky-500/15 text-sky-300 border-sky-500/40" },
  { chip: "text-teal-300 bg-teal-500/15 border-teal-500/35", bar: "border-l-teal-400", av: "bg-teal-500/15 text-teal-300 border-teal-500/40" },
  { chip: "text-amber-300 bg-amber-500/15 border-amber-500/35", bar: "border-l-amber-400", av: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
];

function daysUntil(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const ms = Date.parse(`${iso}T23:59:59Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.ceil((ms - nowMs) / 86_400_000);
}

// Lifecycle tones for a TRACKED deadline. Lapsed is the loudest on purpose:
// it is the one a cleaner design would have quietly dropped.
const PHASE_TONE: Record<string, { cls: string }> = {
  lapsed:     { cls: "text-red-200 bg-red-500/25 border-red-500/60" },
  "due-soon": { cls: "text-amber-200 bg-amber-500/20 border-amber-500/50" },
  open:       { cls: "text-slate-300 bg-slate-700/30 border-slate-600" },
  undated:    { cls: "text-slate-400 bg-slate-700/40 border-slate-600" },
  snoozed:    { cls: "text-slate-500 bg-slate-800/40 border-slate-700" },
  done:       { cls: "text-emerald-300 bg-emerald-500/15 border-emerald-500/40" },
  dismissed:  { cls: "text-slate-500 bg-slate-800/40 border-slate-700" },
};

function phaseText(d: DeadlineView): string {
  if (d.phase === "snoozed") return "Later";
  if (d.phase === "done") return "Done";
  if (d.phase === "dismissed") return "Not mine";
  if (d.phase === "undated") return "No date";
  if (d.daysUntil === null) return "No date";
  if (d.daysUntil < 0) return `${-d.daysUntil}d late`;
  if (d.daysUntil === 0) return "Today";
  return `${d.daysUntil}d`;
}

function dueChip(iso: string | null, nowMs: number): { text: string; cls: string } {
  const d = daysUntil(iso, nowMs);
  if (d === null) return { text: "No date", cls: "text-slate-400 bg-slate-700/40 border-slate-600" };
  if (d < 0) return { text: "Overdue", cls: "text-red-200 bg-red-500/25 border-red-500/60" };
  if (d === 0) return { text: "Today", cls: "text-red-200 bg-red-500/25 border-red-500/60" };
  if (d === 1) return { text: "Tomorrow", cls: "text-red-200 bg-red-500/22 border-red-500/50" };
  if (d <= 3) return { text: `${d} days`, cls: "text-red-200 bg-red-500/18 border-red-500/45" };
  if (d <= 7) return { text: `${d} days`, cls: "text-amber-200 bg-amber-500/16 border-amber-500/45" };
  return { text: `${d} days`, cls: "text-slate-300 bg-slate-700/40 border-slate-600" };
}

const fmtDate = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (!Number.isFinite(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  if (iso.length === 10) return day;
  return `${day} · ${d.toISOString().slice(11, 16)}`;
};

export default function FamilyTab({ active }: { active: boolean }) {
  const [digest, setDigest] = useState<FamilyDigest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [added, setAdded] = useState<Record<string, "adding" | "done" | "error">>({});
  // Persisted deadlines, which outlive the 14-day mail window the extraction
  // is scoped to. `saving` disables the row's controls during a write.
  const [tracked, setTracked] = useState<DeadlineView[]>([]);
  const [rollupLine, setRollupLine] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // Deadlines and events that land inside a trip window — the one thing neither
  // the Family tab nor the trip list can see on its own.
  const [conflicts, setConflicts] = useState<TripConflict[]>([]);
  const [conflictLine, setConflictLine] = useState<string | null>(null);
  // "Until I'm back" needs the next trip's end date; null = no trip ahead.
  const [nextTripEnd, setNextTripEnd] = useState<{ end: string; label: string } | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);   // row id with the picker open
  const [nowMs, setNowMs] = useState(0);
  // School and Household are two readings of the same mailbox with different
  // questions. Household is NOT rendered until selected: it runs its own Gmail
  // query and model call, and must not fire because you opened the tab.
  const [pane, setPane] = useState<"school" | "household">("school");
  const [roster, setRoster] = useState<FamilyProfile | null>(null);

  // Client-only clock: comparing dates during SSR and again on hydration across
  // a midnight boundary throws React #418.
  useEffect(() => { setNowMs(Date.now()); }, []);

  const load = useCallback((refresh = false) => {
    setLoading(true);
    setError(null);
    fetch(`/api/family${refresh ? "?refresh=1" : ""}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || d.error) throw new Error(d?.error || `Request failed (${r.status})`);
        setDigest(d);
        if (Array.isArray(d.tracked)) setTracked(d.tracked);
        setRollupLine(d.rollup?.line ?? null);
        if (Array.isArray(d.tripConflicts)) setConflicts(d.tripConflicts);
        setConflictLine(d.tripConflictLine ?? null);
        setNextTripEnd(d.nextTripEnd ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load family mail"))
      .finally(() => setLoading(false));
  }, []);

  // The `error` guard is load-bearing, not cosmetic. Without it a failing
  // request leaves digest null and loading false, the deps change, and the
  // effect fires again — an unbounded retry loop, each pass costing a Gmail
  // fetch and a model call. Retry is a deliberate tap.
  useEffect(() => {
    if (!active || digest || loading || error) return;
    load();
  }, [active, digest, loading, error, load]);

  // Roster fetched on its own so the editor stays reachable when a digest
  // fails — otherwise a bad roster becomes unfixable from the UI.
  const loadRoster = useCallback(() => {
    fetch("/api/family/roster")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.profile) setRoster(j.profile); })
      .catch(() => {});
  }, []);
  useEffect(() => { if (active && !roster) loadRoster(); }, [active, roster, loadRoster]);

  const profile: FamilyProfile | null = roster ?? digest?.profile ?? null;
  // `family:focus` (detail = person id) — the command palette's door in. The
  // tab mounts only when opened, so a request made before mount is parked in
  // sessionStorage by the palette and consumed here on first render.
  useEffect(() => {
    const scrollTo = (id: string) => {
      const el = document.getElementById(`family-person-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === "string" && id) { try { sessionStorage.removeItem("family.focus"); } catch { /* ignore */ } scrollTo(id); }
    };
    window.addEventListener("family:focus", onFocus);
    try {
      const parked = sessionStorage.getItem("family.focus");
      if (parked) { sessionStorage.removeItem("family.focus"); setTimeout(() => scrollTo(parked), 400); }
    } catch { /* ignore */ }
    return () => window.removeEventListener("family:focus", onFocus);
  }, []);

  const personById = useMemo(() => {
    const m = new Map<string, { person: FamilyPerson; tint: (typeof PERSON_TINT)[number] }>();
    (profile?.people ?? []).forEach((p, i) => m.set(p.id, { person: p, tint: PERSON_TINT[i % PERSON_TINT.length] }));
    return m;
  }, [profile]);

  const addEvent = async (ev: ProposedEvent) => {
    setAdded((s) => ({ ...s, [ev.id]: "adding" }));
    try {
      const res = await fetch("/api/family/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: ev }),
      });
      setAdded((s) => ({ ...s, [ev.id]: res.ok ? "done" : "error" }));
    } catch {
      setAdded((s) => ({ ...s, [ev.id]: "error" }));
    }
  };

  const Who = ({ id }: { id: string | null }) => {
    const e = id ? personById.get(id) : null;
    if (!e) return null;
    return (
      <span className={`text-[10px] font-bold uppercase tracking-wider border rounded-full px-2.5 py-0.5 flex-shrink-0 ${e.tint.chip}`}>
        {e.person.name}
      </span>
    );
  };

  // School-pane body states. These used to be early RETURNS, which skipped the
  // header — and now that the header carries the pane switcher, a failed school
  // digest would strand the user with no way to reach Household. They are a
  // body-level branch so the chrome always renders.
  const schoolBody = (): React.ReactNode => {
    if (!digest && error) {
      return (
        <div className="max-w-md mx-auto py-16 text-center">
          <p className="text-sm text-red-300 mb-1.5">Couldn&rsquo;t load family mail.</p>
          <p className="text-[11px] text-slate-500 mb-4">{error}</p>
          <button onClick={() => load()} className="text-xs font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded-md px-4 py-2 hover:bg-emerald-500/10">
            Retry
          </button>
        </div>
      );
    }
    if (!digest && loading) {
      return <div className="py-16 text-center text-xs text-slate-600 font-mono uppercase tracking-widest animate-pulse">Reading family mail…</div>;
    }
    if (digest?.empty === "no-roster") {
      return (
        <div className="max-w-xl mx-auto py-14 text-center">
          <p className="text-sm text-slate-300 mb-1.5">Tell the app who is in your household.</p>
          <p className="text-xs text-slate-500 leading-relaxed mb-5">
            Add each person, then the school and household senders that write about them. Nothing is read
            until you do — the roster IS the mail search, so this tab only ever touches mail you name.
          </p>
          <button onClick={() => setRosterOpen(true)} className="text-xs font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded-md px-4 py-2 hover:bg-emerald-500/10">
            Set up the roster
          </button>
        </div>
      );
    }
    return null;
  };
  const schoolState = schoolBody();

  const events = digest?.events ?? [];

  const snooze = async (id: string, untilISO: string | null) => {
    setSaving(id);
    setSnoozeFor(null);
    try {
      const res = await fetch("/api/family", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, snoozeUntil: untilISO }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "save failed");
      toast.ok(untilISO ? `Snoozed until ${untilISO}` : "Snooze cleared", untilISO ? "it still lapses if the due date passes" : undefined);
      load();
    } catch (e) {
      toast.error("Could not snooze that", e);
    } finally {
      setSaving(null);
    }
  };
  const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  // Optimistic local state change, then persist. On failure we reload rather
  // than silently leaving the row looking handled — the whole feature is a
  // promise that nothing is quietly lost.
  const setState = async (id: string, state: "done" | "dismissed" | "open") => {
    setSaving(id);
    const before = tracked;
    setTracked((prev) => prev.map((d) => (d.id === id
      ? { ...d, state, phase: state === "open" ? (d.daysUntil === null ? "undated" : d.daysUntil < 0 ? "lapsed" : "open") : state }
      : d)));
    try {
      const res = await fetch("/api/family", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, state }),
      });
      if (!res.ok) throw new Error("save failed");
      toast.ok(state === "done" ? "Marked done" : state === "dismissed" ? "Marked not mine" : "Reopened");
    } catch {
      setTracked(before);
      toast.error("Could not save that change");
      setError("Could not save that change.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-emerald-400">◈ Family</h2>
        <p className="text-[10px] text-slate-600 flex-1 min-w-[16rem]">
          school, activities &amp; household — what needs you, by when · deadlines are pulled out of the email, not left in it
        </p>
        <div className="flex items-center gap-1">
          {([["school", "◈ School"], ["household", "⌂ Household"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setPane(id)}
              className={`text-[10px] font-bold uppercase tracking-wider rounded px-2.5 py-1 border transition-colors ${
                pane === id
                  ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10"
                  : "border-slate-700 text-slate-500 hover:text-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setRosterOpen(true)} className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 border border-slate-700 rounded px-2.5 py-1">
          Roster
        </button>
        <button onClick={() => load(true)} disabled={loading} className="text-[10px] font-mono text-slate-500 hover:text-emerald-400 disabled:opacity-40">
          {loading ? "…" : "↻"}
        </button>
      </div>

      {pane === "household" && <HouseholdPane active={active && pane === "household"} autoDiscover={profile?.autoDiscover !== false} />}

      {pane === "school" && schoolState}

      {pane === "school" && !schoolState && (<>
      {digest?.disabled && (
        <p className="text-[11px] text-amber-300/90 border border-amber-500/30 bg-amber-500/5 rounded-lg px-3 py-2">
          Family digest is off in Preferences → AI Controls. Mail is still being collected; summaries are not.
        </p>
      )}

      {/* Proposals mined from the school mail itself — the portal, the club,
          the coach's organisation the newsletter named. Same model call. */}
      {digest?.proposals && <ProposalsCard proposals={digest.proposals} onChanged={() => { setRoster(null); load(true); }} />}

      {/* Discovery on the school side too — collapsed, because this pane is
          for reading the week, not configuring it; expanded on Household. The
          card still mounts (so the weekly automatic scan can run) — only the
          disclosure is folded. */}
      <details className="group rounded-xl border border-slate-800 bg-slate-900/30">
        <summary className="cursor-pointer select-none list-none flex items-center gap-2 px-3.5 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-300">
          <span className="text-slate-600 group-open:rotate-90 transition-transform">▸</span>
          ⌕ Find school &amp; activity senders I have not declared
        </summary>
        <div className="px-2 pb-2">
          <SenderDiscoveryCard
            heading="⌕ Senders that look like school or activities"
            intro="A newsletter you never declared is a deadline you will never see — this pane only reads senders you named."
            onAccepted={() => { setRoster(null); load(true); }}
            autoDiscover={profile?.autoDiscover !== false}
          />
        </div>
      </details>

      {/* ── while you are away ──
          Above "needs you" because it changes what you do about those items,
          not just whether you know about them. */}
      {conflicts.length > 0 && (
        <div className="border border-violet-500/40 bg-violet-950/10 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-violet-500/25 bg-violet-500/[.06]">
            <span className="text-[11px] font-bold uppercase tracking-widest text-violet-300">✈ While you are away</span>
            <span className="ml-auto text-[10px] text-slate-500">{conflictLine}</span>
          </div>
          {conflicts.map((c) => (
            <div key={`${c.item.id}-${c.trip.id}`} className="flex items-start gap-3 px-3.5 py-2 border-t border-slate-800/70 first:border-t-0">
              <span className={`mt-0.5 w-[64px] flex-shrink-0 text-center text-[9px] font-bold uppercase tracking-wider rounded py-0.5 border ${
                c.severity === "away"
                  ? "text-violet-200 border-violet-500/50 bg-violet-500/15"
                  : "text-amber-200 border-amber-500/45 bg-amber-500/10"
              }`}>
                {c.severity === "away" ? "Away" : "Return"}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-100">{c.item.title}</span>
                <span className="block text-[10.5px] text-slate-500">{c.reason}</span>
              </span>
              <Who id={c.item.personId ?? null} />
            </div>
          ))}
          <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
            Matched from your trip dates against dated obligations — undated items and dates the model only guessed
            at are excluded, since a conflict asserted from a guess is worse than none.
          </p>
        </div>
      )}

      {/* ── needs you ──
          Renders the TRACKED (persisted) deadlines, not the raw extraction.
          The 14-day Gmail window used to be the memory, so a form due in six
          weeks and mentioned once vanished from this board about a fortnight
          later while still being due. Lapsed items stay, deliberately: a
          deadline that disappears when missed teaches nothing. */}
      {tracked.length > 0 && (
        <div className="border border-red-500/35 bg-red-950/10 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-red-500/25 bg-red-500/[.06]">
            <span className="text-[11px] font-bold uppercase tracking-widest text-red-300">
              ⚑ Needs you — {tracked.length} tracked
            </span>
            <span className="ml-auto text-[10px] text-slate-600">{rollupLine ?? "nothing outstanding"}</span>
          </div>
          {tracked.map((d) => {
            const tone = PHASE_TONE[d.phase] ?? PHASE_TONE.open;
            const handled = d.phase === "done" || d.phase === "dismissed";
            return (
              <div key={d.id} className={`flex items-center gap-3 px-3.5 py-2.5 border-t border-slate-800/70 first:border-t-0 ${handled ? "opacity-45" : ""}`}>
                <span className={`w-[86px] flex-shrink-0 text-center rounded-md border py-1 text-[10px] font-bold uppercase tracking-wider font-mono ${tone.cls}`}>
                  {phaseText(d)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-[13.5px] font-bold ${handled ? "text-slate-400 line-through" : "text-slate-100"}`}>{d.title}</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    {d.buried && <span className="text-red-400 font-semibold">Buried in a longer newsletter. </span>}
                    {d.detail}
                  </span>
                  <span className="block text-[9.5px] text-slate-600 mt-0.5">
                    tracked {d.ageDays}d
                    {d.phase === "snoozed" && d.snoozedUntil && ` · snoozed until ${d.snoozedUntil} — still lapses if its date passes`}
                    {d.phase === "undated" && " · no date given — the email never stated one"}
                    {d.onlyRemembered && " · the email has aged out of your inbox search; this is the only record"}
                  </span>
                </span>
                <Who id={d.personId} />
                {!handled ? (
                  <span className="flex-shrink-0 flex items-center gap-1 relative">
                    {/* "Not now" — a third answer between done and not-mine. The
                        record stays open; only attention is deferred. */}
                    {d.phase !== "lapsed" && (
                      <button onClick={() => setSnoozeFor(snoozeFor === d.id ? null : d.id)} disabled={saving !== null}
                        aria-expanded={snoozeFor === d.id}
                        className="text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-40">
                        {d.phase === "snoozed" ? "Snoozed" : "Later"}
                      </button>
                    )}
                    {snoozeFor === d.id && (
                      <span className="absolute right-0 top-full mt-1 z-20 flex flex-col gap-1 bg-slate-950 border border-slate-700 rounded-lg p-1.5 shadow-xl min-w-[170px]">
                        <button onClick={() => snooze(d.id, plusDays(3))} className="text-left text-[10px] px-2 py-1 rounded hover:bg-slate-800 text-slate-300">3 days</button>
                        <button onClick={() => snooze(d.id, plusDays(7))} className="text-left text-[10px] px-2 py-1 rounded hover:bg-slate-800 text-slate-300">1 week</button>
                        {nextTripEnd && (
                          <button onClick={() => snooze(d.id, nextTripEnd.end)} className="text-left text-[10px] px-2 py-1 rounded hover:bg-slate-800 text-violet-300">
                            Until I&apos;m back <span className="text-slate-500">({nextTripEnd.label}, {nextTripEnd.end.slice(5)})</span>
                          </button>
                        )}
                        {d.phase === "snoozed" && (
                          <button onClick={() => snooze(d.id, null)} className="text-left text-[10px] px-2 py-1 rounded hover:bg-slate-800 text-amber-300">Clear snooze</button>
                        )}
                      </span>
                    )}
                    <button onClick={() => setState(d.id, "done")} disabled={saving !== null}
                      className="text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40">
                      {saving === d.id ? "…" : "Done"}
                    </button>
                    <button onClick={() => setState(d.id, "dismissed")} disabled={saving !== null}
                      title="Not mine / not a real obligation"
                      className="text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-500 hover:text-slate-300 disabled:opacity-40">
                      Not mine
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setState(d.id, "open")} disabled={saving !== null}
                    className="flex-shrink-0 text-[9px] uppercase tracking-wider text-slate-600 hover:text-slate-400 disabled:opacity-40">
                    undo
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-5 items-start">
        {/* ── per person ── */}
        <div className="space-y-4">
          {Array.from(personById.values()).map((e) => {
            // Iterate the ROSTER, not the model's output: a child with tracked
            // deadlines but no summary this pass still gets a card. The
            // summary is merged in when the model produced one.
            const pd = digest?.people?.find((p) => p.personId === e.person.id) ?? null;
            // Outstanding only: a person's badge should count what still
            // needs doing, not everything ever extracted for them.
            const mineList = tracked.filter((d) => d.personId === e.person.id && d.phase !== "done" && d.phase !== "dismissed");
            const mine = mineList.length;
            const lapsedMine = mineList.filter((d) => d.phase === "lapsed").length;
            return (
              <div key={e.person.id} id={`family-person-${e.person.id}`} className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden scroll-mt-24">
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-800 bg-slate-800/30">
                  <span className={`w-7 h-7 rounded-lg border flex items-center justify-center text-xs font-bold flex-shrink-0 ${e.tint.av}`}>
                    {e.person.name.charAt(0)}
                  </span>
                  <span className="min-w-0">
                    <span className="text-[13px] font-bold text-slate-100">{e.person.name}</span>
                    <span className="text-[10.5px] text-slate-500">
                      {[e.person.grade, e.person.school].filter(Boolean).length > 0 && " · "}
                      {[e.person.grade && `${e.person.grade} grade`, e.person.school].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {mine > 0 && (
                    <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${lapsedMine > 0 ? "text-red-300 bg-red-500/12" : "text-amber-300 bg-amber-500/10"}`}>
                      {mine} open{lapsedMine > 0 ? ` · ${lapsedMine} late` : ""}
                    </span>
                  )}
                </div>
                {pd?.summary && <p className="px-3.5 py-3 text-[12.5px] text-slate-300 leading-relaxed">{pd.summary}</p>}
                {/* This person's tracked deadlines — the persisted record, which
                    outlives the mail window the summary above was read from. */}
                {mineList.length > 0 && (
                  <div className="border-t border-slate-800/60 px-3.5 py-2">
                    {mineList.slice(0, 5).map((d) => (
                      <div key={d.id} className="flex items-baseline gap-2.5 py-1 text-[11.5px]">
                        <span className={`w-16 flex-shrink-0 text-center rounded border py-px text-[9px] font-bold uppercase tracking-wider font-mono ${(PHASE_TONE[d.phase] ?? PHASE_TONE.open).cls}`}>{phaseText(d)}</span>
                        <span className="min-w-0 text-slate-300 truncate">{d.title}</span>
                      </div>
                    ))}
                    {mineList.length > 5 && <p className="text-[10px] text-slate-600 pt-1">+{mineList.length - 5} more above in Needs you</p>}
                  </div>
                )}
                {(pd?.upcoming?.length ?? 0) > 0 && (
                  <div className="border-t border-slate-800/60 px-3.5 py-2">
                    {pd!.upcoming.map((u, i) => (
                      <div key={i} className="flex items-baseline gap-2.5 py-1 text-[11.5px] text-slate-300">
                        <span className="w-16 flex-shrink-0 font-mono text-[10.5px] text-slate-500">{u.whenLabel || fmtDate(u.whenISO)}</span>
                        <span className="min-w-0">
                          {u.text}
                          {u.source && <span className="text-[9.5px] text-slate-600 italic"> · {u.source}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {digest?.household && (
            <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-800 bg-slate-800/30">
                <span className="w-7 h-7 rounded-lg border border-teal-500/35 bg-teal-500/14 text-teal-300 flex items-center justify-center text-xs flex-shrink-0">⌂</span>
                <span className="text-[13px] font-bold text-slate-100">Household</span>
                <span className="text-[10.5px] text-slate-500">· appointments, travel &amp; family mail</span>
              </div>
              <p className="px-3.5 py-3 text-[12.5px] text-slate-300 leading-relaxed">{digest.household}</p>
            </div>
          )}
        </div>

        {/* ── dates + coverage ── */}
        <div className="space-y-4">
          <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
              <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">◷ Dates found</span>
              <span className="ml-auto text-[10px] text-slate-600">{events.length} in {digest?.coverage.windowDays ?? 14}d</span>
            </div>

            {events.length === 0 && <p className="px-3.5 py-3 text-[11px] text-slate-600">No dates in the current window.</p>}

            {events.map((ev) => {
              const state = added[ev.id];
              return (
                <div key={ev.id} className={`px-3.5 py-2.5 border-b border-slate-800/60 last:border-b-0 ${ev.needsConfirm ? "border-l-2 border-l-amber-500/70" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[11px] font-bold flex-shrink-0 ${ev.needsConfirm ? "text-amber-400" : "text-emerald-400"}`}>
                      {ev.startISO ? fmtDate(ev.startISO) : "?? date"}
                    </span>
                    <span className="text-[12px] text-slate-200 truncate">{ev.title}</span>
                  </div>
                  <p className="text-[9.5px] text-slate-600 mt-0.5">
                    {ev.sourceLabel}
                    {ev.supersedes && <span className="text-amber-500/90"> · replaces: {ev.supersedes}</span>}
                    {ev.relativePhrase && (
                      <span className="text-amber-500/90">
                        {ev.sourceLabel ? " · " : ""}Email said “{ev.relativePhrase}” with no date. <b>Not guessed.</b>
                      </span>
                    )}
                  </p>
                  <div className="flex gap-1.5 mt-1.5">
                    {state === "done" ? (
                      <span className="text-[10px] font-bold text-emerald-400">✓ Added to calendar</span>
                    ) : ev.needsConfirm ? (
                      <span className="text-[9.5px] font-bold uppercase tracking-wider text-amber-400 border border-amber-500/45 bg-amber-500/10 rounded px-2 py-1">
                        Open the email to set a date
                      </span>
                    ) : (
                      <button
                        onClick={() => addEvent(ev)}
                        disabled={state === "adding"}
                        className="text-[9.5px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/50 bg-emerald-500/10 rounded px-2.5 py-1 hover:bg-emerald-500/20 disabled:opacity-40"
                      >
                        {state === "adding" ? "Adding…" : "＋ Add"}
                      </button>
                    )}
                    {state === "error" && <span className="text-[10px] text-red-400">Calendar refused it</span>}
                  </div>
                </div>
              );
            })}

            <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
              Nothing reaches your calendar until you tap Add. Relative dates (“next Friday”, “the 15th”) are
              flagged, never resolved silently.
            </p>
          </div>

          {/* coverage */}
          <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
            <div className="px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">✓ Coverage</span>
            </div>
            <div className="px-3.5 py-2.5 text-[11px] text-slate-300 leading-relaxed">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1">Nothing missed</span>
              {digest?.coverage.scanned ?? 0} family email{(digest?.coverage.scanned ?? 0) === 1 ? "" : "s"} from the
              last {digest?.coverage.windowDays ?? 14} days read and summarised, across{" "}
              {digest?.coverage.senders ?? 0} watched sender{(digest?.coverage.senders ?? 0) === 1 ? "" : "s"}.
              {digest?.empty === "no-mail" && <span className="text-slate-500"> Nothing has arrived in this window.</span>}
              <button onClick={() => setRosterOpen(true)} className="block mt-2 text-[10px] font-bold uppercase tracking-wider text-emerald-400/80 hover:text-emerald-300">
                Edit roster &amp; senders →
              </button>
            </div>
          </div>
        </div>
      </div>

      </>)}

      {rosterOpen && profile && (
        <FamilyRosterEditor
          profile={profile}
          onClose={() => setRosterOpen(false)}
          onSaved={() => { setRosterOpen(false); setDigest(null); setError(null); setRoster(null); }}
        />
      )}
    </div>
  );
}
