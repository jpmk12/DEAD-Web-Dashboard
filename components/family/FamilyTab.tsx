"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FamilyDigest, FamilyDeadline } from "@/lib/family";
import type { FamilyPerson, FamilyProfile } from "@/lib/familyProfile";
import type { ProposedEvent } from "@/lib/familyDates";
import FamilyRosterEditor from "@/components/family/FamilyRosterEditor";

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
  const [nowMs, setNowMs] = useState(0);

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

  const profile: FamilyProfile | null = digest?.profile ?? null;
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
        {rosterOpen && profile && (
          <FamilyRosterEditor profile={profile} onClose={() => setRosterOpen(false)} onSaved={() => { setRosterOpen(false); setDigest(null); }} />
        )}
      </div>
    );
  }

  const deadlines: FamilyDeadline[] = digest?.deadlines ?? [];
  const events = digest?.events ?? [];

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-emerald-400">◈ Family</h2>
        <p className="text-[10px] text-slate-600 flex-1 min-w-[16rem]">
          school, activities &amp; household — what needs you, by when · deadlines are pulled out of the email, not left in it
        </p>
        <button onClick={() => setRosterOpen(true)} className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 border border-slate-700 rounded px-2.5 py-1">
          Roster
        </button>
        <button onClick={() => load(true)} disabled={loading} className="text-[10px] font-mono text-slate-500 hover:text-emerald-400 disabled:opacity-40">
          {loading ? "…" : "↻"}
        </button>
      </div>

      {digest?.disabled && (
        <p className="text-[11px] text-amber-300/90 border border-amber-500/30 bg-amber-500/5 rounded-lg px-3 py-2">
          Family digest is off in Preferences → AI Controls. Mail is still being collected; summaries are not.
        </p>
      )}

      {/* ── needs you ── */}
      {deadlines.length > 0 && (
        <div className="border border-red-500/35 bg-red-950/10 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-red-500/25 bg-red-500/[.06]">
            <span className="text-[11px] font-bold uppercase tracking-widest text-red-300">
              ⚑ Needs you — {deadlines.length} item{deadlines.length === 1 ? "" : "s"} with a deadline
            </span>
            <span className="ml-auto text-[10px] text-slate-600">soonest first</span>
          </div>
          {deadlines.map((d, i) => {
            const chip = dueChip(d.dueISO, nowMs);
            return (
              <div key={`${d.sourceId}-${i}`} className="flex items-center gap-3 px-3.5 py-2.5 border-t border-slate-800/70 first:border-t-0">
                <span className={`w-[86px] flex-shrink-0 text-center rounded-md border py-1 text-[10px] font-bold uppercase tracking-wider font-mono ${chip.cls}`}>
                  {chip.text}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-bold text-slate-100">{d.title}</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    {d.buried && <span className="text-red-400 font-semibold">Buried in a longer newsletter. </span>}
                    {d.detail}
                  </span>
                </span>
                <Who id={d.personId} />
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-5 items-start">
        {/* ── per person ── */}
        <div className="space-y-4">
          {(digest?.people ?? []).map((pd) => {
            const e = personById.get(pd.personId);
            if (!e) return null;
            const mine = deadlines.filter((d) => d.personId === pd.personId).length;
            return (
              <div key={pd.personId} className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
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
                    <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-red-300 bg-red-500/12 rounded px-1.5 py-0.5">
                      {mine} deadline{mine === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {pd.summary && <p className="px-3.5 py-3 text-[12.5px] text-slate-300 leading-relaxed">{pd.summary}</p>}
                {pd.upcoming.length > 0 && (
                  <div className="border-t border-slate-800/60 px-3.5 py-2">
                    {pd.upcoming.map((u, i) => (
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

      {rosterOpen && profile && (
        <FamilyRosterEditor profile={profile} onClose={() => setRosterOpen(false)} onSaved={() => { setRosterOpen(false); setDigest(null); }} />
      )}
    </div>
  );
}
