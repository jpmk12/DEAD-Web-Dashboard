"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FamilyDigest } from "@/lib/family";
import type { DeadlineView, GroupedDeadline } from "@/lib/familyDeadlines";
import { dedupeDeadlines, splitHandled, isNewSince, todayYmd } from "@/lib/familyDeadlines";
import { awayText, type AwayList } from "@/lib/familyAway";
import { datesInText } from "@/lib/datesInText";
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
//
// REVIEW-2026-10 §5 (F1–F9): an attention line; done rows fold away; the
// same obligation from several newsletters is one row; Set date offers the
// dates the email names; each kid's brief is a running brief with "new"
// markers and a new-mail check while the tab is open; While you are away is
// the list for the call home; proposals and discovery sit below the content.

const PERSON_TINT = [
  { chip: "text-violet-300 bg-violet-500/15 border-violet-500/35", av: "bg-violet-500/15 text-violet-300 border-violet-500/40" },
  { chip: "text-sky-300 bg-sky-500/15 border-sky-500/35", av: "bg-sky-500/15 text-sky-300 border-sky-500/40" },
  { chip: "text-teal-300 bg-teal-500/15 border-teal-500/35", av: "bg-teal-500/15 text-teal-300 border-teal-500/40" },
  { chip: "text-amber-300 bg-amber-500/15 border-amber-500/35", av: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
];

// Lifecycle tones for a TRACKED deadline. Lapsed is the loudest on purpose:
// it is the one a cleaner design would have quietly dropped.
const PHASE_TONE: Record<string, string> = {
  lapsed: "text-red-200 bg-red-500/25 border-red-500/60",
  "due-soon": "text-amber-200 bg-amber-500/20 border-amber-500/50",
  open: "text-slate-300 bg-slate-700/30 border-slate-600",
  undated: "text-slate-300 bg-slate-700/40 border-slate-600",
  snoozed: "text-violet-200 bg-violet-500/12 border-violet-500/40",
  done: "text-emerald-300 bg-emerald-500/15 border-emerald-500/40",
  dismissed: "text-slate-500 bg-slate-800/40 border-slate-700",
};

function phaseText(d: DeadlineView): string {
  if (d.phase === "snoozed") return "Later";
  if (d.phase === "done") return "Done";
  if (d.phase === "dismissed") return "Not mine";
  if (d.phase === "undated" || d.daysUntil === null) return "No date";
  if (d.daysUntil < 0) return `${-d.daysUntil}d late`;
  if (d.daysUntil === 0) return "Today";
  return d.dueISO ? fmtShort(d.dueISO) : `${d.daysUntil}d`;
}

const fmtShort = (iso: string): string => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" }) : iso;
};
const fmtDate = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (!Number.isFinite(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return iso.length === 10 ? day : `${day} · ${d.toISOString().slice(11, 16)}`;
};
const ago = (ms: number, nowMs: number): string => {
  if (!ms || !nowMs) return "";
  const m = Math.max(0, Math.round((nowMs - ms) / 60_000));
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

const CHECK_EVERY_MS = 10 * 60_000;
const BTN = "text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border disabled:opacity-40 whitespace-nowrap";
const NEW_CHIP = "inline-block ml-1.5 align-middle text-[8.5px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/15 rounded px-1 py-px";

export default function FamilyTab({ active }: { active: boolean }) {
  const [digest, setDigest] = useState<FamilyDigest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [added, setAdded] = useState<Record<string, "adding" | "done" | "error">>({});
  // Persisted deadlines, which outlive the 14-day mail window the extraction
  // is scoped to. `saving` disables the row's controls during a write.
  const [tracked, setTracked] = useState<DeadlineView[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [away, setAway] = useState<AwayList | null>(null);
  const [nextTripEnd, setNextTripEnd] = useState<{ end: string; label: string } | null>(null);
  const [lastVisitMs, setLastVisitMs] = useState(0);
  const [menuFor, setMenuFor] = useState<string | null>(null);   // row id with the Set date / Later menu open
  const [dateDraft, setDateDraft] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const [pane, setPane] = useState<"school" | "household">("school");
  const [roster, setRoster] = useState<FamilyProfile | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Client-only clock: comparing dates during SSR and again on hydration across
  // a midnight boundary throws React #418. Ticks each minute for the "ago"s.
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const applyPayload = useCallback((d: FamilyDigest & { tracked?: DeadlineView[]; away?: AwayList | null; nextTripEnd?: { end: string; label: string } | null; lastVisitMs?: number }) => {
    setDigest(d);
    if (Array.isArray(d.tracked)) setTracked(d.tracked);
    setAway(d.away ?? null);
    setNextTripEnd(d.nextTripEnd ?? null);
    if (typeof d.lastVisitMs === "number") setLastVisitMs(d.lastVisitMs);
  }, []);

  // `quiet` = a reload after one of our own writes: it must not bump the
  // "last visit" (that would erase the new-since markers mid-session).
  const load = useCallback((refresh = false, quiet = false) => {
    setLoading(true);
    setError(null);
    const qs = refresh ? "?refresh=1" : quiet ? "?silent=1" : "";
    fetch(`/api/family${qs}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || d.error) throw new Error(d?.error || `Request failed (${r.status})`);
        applyPayload(d);
        setCheckedAt(Date.now());
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load family mail"))
      .finally(() => setLoading(false));
  }, [applyPayload]);

  // The `error` guard is load-bearing, not cosmetic. Without it a failing
  // request leaves digest null and loading false, the deps change, and the
  // effect fires again — an unbounded retry loop, each pass costing a Gmail
  // fetch and a model call. Retry is a deliberate tap.
  useEffect(() => {
    if (!active || digest || loading || error) return;
    load();
  }, [active, digest, loading, error, load]);

  // New-mail check while the tab is open and visible (F4): one Gmail list
  // call every 10 minutes, no bodies, no model. Only a changed id set
  // re-reads — and the assembler re-checks the same thing before spending.
  useEffect(() => {
    if (!active || !digest || digest.empty) return;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible" || loading) return;
      try {
        const r = await fetch("/api/family?check=1");
        const d = await r.json().catch(() => null);
        setCheckedAt(Date.now());
        if (d && typeof d.newMail === "number" && d.newMail > 0) {
          toast.info(`${d.newMail} new family email${d.newMail === 1 ? "" : "s"} — updating the briefs`);
          load(true);
        }
      } catch { /* best-effort */ }
    };
    const t = setInterval(check, CHECK_EVERY_MS);
    const onVis = () => { if (document.visibilityState === "visible" && Date.now() - checkedAt > CHECK_EVERY_MS) check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [active, digest, loading, checkedAt, load]);

  // Roster fetched on its own so the editor stays reachable when a digest
  // fails — otherwise a bad roster becomes unfixable from the UI.
  const loadRoster = useCallback(() => {
    fetch("/api/family/roster")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.profile) setRoster(j.profile); })
      .catch(() => {});
  }, []);
  useEffect(() => { if (active && !roster) loadRoster(); }, [active, roster, loadRoster]);

  // Close the Set date / Later menu on an outside click or Escape.
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuFor(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuFor]);

  const profile: FamilyProfile | null = roster ?? digest?.profile ?? null;
  // `family:focus` (detail = person id) — the command palette's door in.
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
  const nameOf = (id: string | null) => (id ? personById.get(id)?.person.name ?? "household" : "household");

  // ── the grouped record ────────────────────────────────────────────────────
  const grouped = useMemo(() => dedupeDeadlines(tracked), [tracked]);
  const { open: openRows, handled: handledRows } = useMemo(() => splitHandled(grouped), [grouped]);
  const today = nowMs ? todayYmd(nowMs) : todayYmd();
  const undatedNamed = openRows.filter((d) => d.phase === "undated" && datesInText(`${d.title}. ${d.detail}`, today).length > 0).length;
  const newDeadlines = openRows.filter((d) => isNewSince(d, lastVisitMs)).length;
  const newFromBriefs = (digest?.people ?? []).reduce((n, p) => n + (p.newMail ?? 0), 0);
  const awayCount = away ? away.happened.length + away.ahead.length : 0;
  const proposalCount = (digest?.proposals?.senders.length ?? 0) + (digest?.proposals?.documents.length ?? 0);
  const generatedMs = digest?.generatedAt ? Date.parse(digest.generatedAt) : 0;
  const events = digest?.events ?? [];

  const addEvent = async (ev: ProposedEvent) => {
    setAdded((s) => ({ ...s, [ev.id]: "adding" }));
    try {
      const res = await fetch("/api/family/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: ev }) });
      setAdded((s) => ({ ...s, [ev.id]: res.ok ? "done" : "error" }));
    } catch {
      setAdded((s) => ({ ...s, [ev.id]: "error" }));
    }
  };

  const Who = ({ id, small }: { id: string | null; small?: boolean }) => {
    const e = id ? personById.get(id) : null;
    const cls = e ? e.tint.chip : "text-slate-400 bg-slate-700/30 border-slate-600";
    return (
      <span className={`${small ? "text-[8.5px] px-2" : "text-[10px] px-2.5"} font-bold uppercase tracking-wider border rounded-full py-0.5 flex-shrink-0 ${cls}`}>
        {e ? e.person.name : "both"}
      </span>
    );
  };

  // ── writes ────────────────────────────────────────────────────────────────
  const patchAll = async (ids: string[], body: Record<string, unknown>) => {
    const results = await Promise.all(ids.map((id) => fetch("/api/family", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) })));
    const bad = results.find((r) => !r.ok);
    if (bad) { const j = await bad.json().catch(() => null); throw new Error(j?.error || "save failed"); }
  };

  // Optimistic local change across every merged id, then persist, then a
  // QUIET reload so the rollup and the per-person counts catch up.
  const setState = async (row: GroupedDeadline, state: "done" | "dismissed" | "open") => {
    setSaving(row.id);
    setMenuFor(null);
    const before = tracked;
    const ids = new Set(row.mergedIds);
    setTracked((prev) => prev.map((d) => (ids.has(d.id)
      ? { ...d, state, phase: state === "open" ? (d.daysUntil === null ? "undated" : d.daysUntil < 0 ? "lapsed" : d.daysUntil <= 7 ? "due-soon" : "open") : state }
      : d)));
    try {
      await patchAll(row.mergedIds, { state });
      toast.ok(state === "done" ? "Marked done" : state === "dismissed" ? "Marked not mine" : "Reopened");
      load(false, true);
    } catch (e) {
      setTracked(before);
      toast.error("Could not save that change", e);
    } finally {
      setSaving(null);
    }
  };

  const snooze = async (row: GroupedDeadline, untilISO: string | null) => {
    setSaving(row.id);
    setMenuFor(null);
    try {
      await patchAll(row.mergedIds, { snoozeUntil: untilISO });
      toast.ok(untilISO ? `Snoozed until ${fmtShort(untilISO)}` : "Snooze cleared", untilISO ? "it still lapses if its date passes" : undefined);
      load(false, true);
    } catch (e) {
      toast.error("Could not snooze that", e);
    } finally {
      setSaving(null);
    }
  };

  const setDue = async (row: GroupedDeadline, iso: string | null) => {
    setSaving(row.id);
    setMenuFor(null);
    setDateDraft("");
    const before = tracked;
    const ids = new Set(row.mergedIds);
    setTracked((prev) => prev.map((d) => (ids.has(d.id) ? { ...d, dueISO: iso, dueSource: "user" as const } : d)));
    try {
      await patchAll(row.mergedIds, { dueIso: iso });
      toast.ok(iso ? `Due ${fmtShort(iso)}` : "Date cleared", "yours — a later email never overwrites it");
      load(false, true);
    } catch (e) {
      setTracked(before);
      toast.error("Could not set that date", e);
    } finally {
      setSaving(null);
    }
  };
  const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  const copyAway = async () => {
    if (!away) return;
    try { await navigator.clipboard.writeText(awayText(away, nameOf)); toast.ok("Copied the list for the call"); }
    catch { toast.error("Could not copy"); }
  };

  // School-pane body states — a body-level branch so the chrome always
  // renders and Household stays reachable when the school digest fails.
  const schoolBody = (): React.ReactNode => {
    if (!digest && error) {
      return (
        <div className="max-w-md mx-auto py-16 text-center">
          <p className="text-sm text-red-300 mb-1.5">Couldn&rsquo;t load family mail.</p>
          <p className="text-[11px] text-slate-500 mb-4">{error}</p>
          <button onClick={() => load()} className="text-xs font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded-md px-4 py-2 hover:bg-emerald-500/10">Retry</button>
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
          <button onClick={() => setRosterOpen(true)} className="text-xs font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded-md px-4 py-2 hover:bg-emerald-500/10">Set up the roster</button>
        </div>
      );
    }
    return null;
  };
  const schoolState = schoolBody();

  // ── the Set date / Later menu ─────────────────────────────────────────────
  const rowMenu = (d: GroupedDeadline) => {
    const named = datesInText(`${d.title}. ${d.detail}`, today).filter((n) => n.iso !== d.dueISO);
    return (
      <div ref={menuRef} role="menu" className="absolute right-0 top-full mt-1 z-30 w-[300px] bg-slate-950 border border-slate-700 rounded-lg p-1.5 shadow-2xl text-left normal-case tracking-normal">
        {named.length > 0 && (
          <>
            <p className="px-2 pt-1 pb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Dates named in the email — tap to use</p>
            {named.map((n) => (
              <button key={n.iso} onClick={() => setDue(d, n.iso)} className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 flex items-baseline gap-2">
                <span className="font-mono text-[11px] text-emerald-300 whitespace-nowrap">{fmtDate(n.iso)}</span>
                <span className="text-[10px] text-slate-500 truncate">“{n.phrase}”</span>
              </button>
            ))}
          </>
        )}
        <p className="px-2 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{d.dueISO ? "Change the date" : "Or pick a date"}</p>
        <div className="flex items-center gap-1.5 px-2 pb-1">
          <input type="date" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)} className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-emerald-500/50" />
          <button onClick={() => { if (dateDraft) setDue(d, dateDraft); }} disabled={!dateDraft} className={`${BTN} border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10`}>Set</button>
        </div>
        {d.dueISO && d.dueSource === "user" && (
          <button onClick={() => setDue(d, null)} className="w-full text-left px-2 py-1.5 rounded text-[10.5px] text-slate-400 hover:bg-slate-800 hover:text-slate-200">Clear the date I set</button>
        )}
        {d.phase !== "lapsed" && (
          <>
            <div className="h-px bg-slate-800 my-1" />
            <p className="px-2 pt-0.5 pb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Or snooze</p>
            {[[3, "3 days"], [7, "1 week"]].map(([n, label]) => (
              <button key={String(n)} onClick={() => snooze(d, plusDays(Number(n)))} className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 text-[11px] text-slate-300 flex">
                {label}<span className="ml-auto font-mono text-[10px] text-slate-500">{fmtShort(plusDays(Number(n)))}</span>
              </button>
            ))}
            {nextTripEnd && nextTripEnd.end > today && (
              <button onClick={() => snooze(d, nextTripEnd.end)} className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 text-[11px] text-violet-300 flex">
                Until I&rsquo;m back<span className="ml-auto font-mono text-[10px] text-slate-500">{nextTripEnd.label.split(/[,(]/)[0].trim()} · {fmtShort(nextTripEnd.end)}</span>
              </button>
            )}
            {d.phase === "snoozed" && (
              <button onClick={() => snooze(d, null)} className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 text-[11px] text-amber-300">Clear snooze</button>
            )}
          </>
        )}
        <p className="px-2 pt-1.5 pb-1 text-[9.5px] text-slate-600 leading-snug border-t border-slate-800 mt-1">
          A date you set is yours — a later email never overwrites it. Nothing is assigned automatically.
        </p>
      </div>
    );
  };

  // ── a Needs-you row ───────────────────────────────────────────────────────
  const needsRow = (d: GroupedDeadline) => {
    const isNew = isNewSince(d, lastVisitMs);
    const named = d.phase === "undated" ? datesInText(`${d.title}. ${d.detail}`, today) : [];
    return (
      <div key={d.id} className="flex items-start gap-3 px-3.5 py-2.5 border-t border-slate-800/70 first:border-t-0">
        <span className={`mt-0.5 w-[82px] flex-shrink-0 text-center rounded-md border py-1 text-[9.5px] font-bold uppercase tracking-wider font-mono ${PHASE_TONE[d.phase] ?? PHASE_TONE.open}`}>
          {phaseText(d)}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13.5px] font-bold text-slate-100">
            {d.title}
            {isNew && <span className={NEW_CHIP}>new</span>}
          </span>
          <span className="block text-[11px] text-slate-400 mt-0.5 leading-snug">
            {d.buried && <span className="text-red-400 font-semibold">Buried in a longer newsletter. </span>}
            {d.detail}
            {named.length > 0 && (
              <span className="text-amber-300/90"> The email names {named.map((n) => fmtShort(n.iso)).join(", ")} — the deadline itself was not stated, so the app did not assume it.</span>
            )}
          </span>
          <span className="block text-[9.5px] text-slate-600 mt-0.5 font-mono">
            tracked {d.ageDays}d
            {d.mergedCount > 1 && <span className="text-violet-300"> · ×{d.mergedCount} newsletters</span>}
            {d.dueISO && d.dueSource === "user" && " · date set by you"}
            {d.phase === "snoozed" && d.snoozedUntil && ` · snoozed until ${fmtShort(d.snoozedUntil)} — still lapses if its date passes`}
            {d.phase === "undated" && named.length === 0 && " · no date given — the email never stated one"}
            {d.onlyRemembered && " · the email has aged out of your inbox search; this is the only record"}
          </span>
        </span>
        <Who id={d.personId} />
        <span className="flex-shrink-0 flex items-center gap-1 relative">
          <button onClick={() => { setDateDraft(d.dueISO ?? ""); setMenuFor(menuFor === d.id ? null : d.id); }} disabled={saving !== null}
            aria-expanded={menuFor === d.id} aria-haspopup="menu"
            className={`${BTN} ${d.phase === "undated" ? "border-sky-500/50 text-sky-300 hover:bg-sky-500/10" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>
            {d.phase === "undated" ? "Set date ▾" : d.phase === "snoozed" ? "Snoozed ▾" : "Later ▾"}
          </button>
          {menuFor === d.id && rowMenu(d)}
          <button onClick={() => setState(d, "done")} disabled={saving !== null} className={`${BTN} border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10`}>
            {saving === d.id ? "…" : "Done"}
          </button>
          <button onClick={() => setState(d, "dismissed")} disabled={saving !== null} title="Not mine / not a real obligation" className={`${BTN} border-slate-700 text-slate-500 hover:text-slate-300`}>
            Not mine
          </button>
        </span>
      </div>
    );
  };

  // ── an event line (per person, with ＋ Add) ───────────────────────────────
  const eventLine = (ev: ProposedEvent) => {
    const state = added[ev.id];
    const srcMs = ev.sourceLabel ? 0 : 0; // events carry no message date; new-ness comes from the person's brief
    void srcMs;
    return (
      <div key={ev.id} className="flex items-baseline gap-2.5 py-1 text-[11.5px]">
        {/* Date column: a fixed width keeps the titles aligned, so a TIMED
            event stacks its time under the date instead of overrunning the
            title (bug report 2026-10-07: "Sat, Oct 17 · 18:00" ran into "PTO
            Trunk or Treat"). */}
        <span className={`w-[78px] flex-shrink-0 font-mono text-[10.5px] leading-tight ${ev.needsConfirm ? "text-amber-400" : "text-slate-400"}`}>
          {(() => {
            const [day, time] = (ev.startISO ? fmtDate(ev.startISO) : "?? date").split(" · ");
            return <>
              <span className="block whitespace-nowrap">{day}</span>
              {time && <span className="block whitespace-nowrap text-[9.5px] text-slate-500">{time}</span>}
            </>;
          })()}
        </span>
        <span className="min-w-0 flex-1 text-slate-300">
          {ev.title}
          {ev.sourceLabel && <span className="text-[9.5px] text-slate-600 italic"> · {ev.sourceLabel}</span>}
          {ev.supersedes && <span className="text-[9.5px] text-amber-500/90"> · replaces: {ev.supersedes}</span>}
          {ev.needsConfirm && <span className="block text-[9.5px] text-amber-500/90">Email said “{ev.relativePhrase ?? "a relative date"}” with no date — not guessed; open the email to set one.</span>}
        </span>
        <span className="flex-shrink-0">
          {state === "done" ? <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">on calendar ✓</span>
            : ev.needsConfirm ? null
            : <button onClick={() => addEvent(ev)} disabled={state === "adding"} className={`${BTN} border-sky-500/50 text-sky-300 hover:bg-sky-500/10`}>{state === "adding" ? "Adding…" : "＋ Add"}</button>}
          {state === "error" && <span className="ml-1 text-[9.5px] text-red-400">Calendar refused it</span>}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-emerald-400">◈ Family</h2>
        <div className="ml-auto flex items-center gap-1">
          {([["school", "◈ School"], ["household", "⌂ Household"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setPane(id)}
              className={`text-[10px] font-bold uppercase tracking-wider rounded px-2.5 py-1 border transition-colors ${pane === id ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setRosterOpen(true)} className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 border border-slate-700 rounded px-2.5 py-1">Roster</button>
        <button onClick={() => load(true)} disabled={loading} title="Re-read the mail now" className="text-[10px] font-mono text-slate-500 hover:text-emerald-400 disabled:opacity-40">{loading ? "…" : "↻"}</button>
      </div>

      {pane === "household" && <HouseholdPane active={active && pane === "household"} autoDiscover={profile?.autoDiscover !== false} />}

      {pane === "school" && schoolState}

      {pane === "school" && !schoolState && digest && (<>
      {/* ── attention line (F9) ── */}
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-2 text-[12px] text-slate-300">
        <span><b className="text-slate-100">{openRows.length}</b> need{openRows.length === 1 ? "s" : ""} you</span>
        {undatedNamed > 0 && <><span className="text-slate-700">·</span><span><b className="text-slate-100">{undatedNamed}</b> ha{undatedNamed === 1 ? "s" : "ve"} no date — <span className="text-amber-300">the email names one</span></span></>}
        {awayCount > 0 && <><span className="text-slate-700">·</span><span><b className="text-slate-100">{away!.ahead.length}</b> land{away!.ahead.length === 1 ? "s" : ""} while you are away</span></>}
        {proposalCount > 0 && <><span className="text-slate-700">·</span><a href="#family-proposals" className="hover:text-sky-300"><b className="text-slate-100">{proposalCount}</b> to file ↓</a></>}
        <span className="ml-auto text-[10px] font-mono text-slate-500">
          {generatedMs ? `updated ${ago(generatedMs, nowMs)}` : ""}
          {newDeadlines + newFromBriefs > 0 && <span className="text-emerald-400"> · {newDeadlines + newFromBriefs} new since your last visit</span>}
          {digest.briefFailed && <span className="text-amber-400"> · model call failed — showing the last briefs</span>}
          <span> · checks for new mail every 10 min</span>
        </span>
      </div>

      {digest.disabled && (
        <p className="text-[11px] text-amber-300/90 border border-amber-500/30 bg-amber-500/5 rounded-lg px-3 py-2">
          Family digest is off in Preferences → AI Controls. Mail is still being collected; summaries are not.
        </p>
      )}

      {/* ── needs you (F1, F2, F3) ── */}
      {(openRows.length > 0 || handledRows.length > 0) && (
        <div className="border border-red-500/35 bg-red-950/10 rounded-xl">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-red-500/25 bg-red-500/[.06] rounded-t-xl">
            <span className="text-[11px] font-bold uppercase tracking-widest text-red-300">⚑ Needs you</span>
            <span className="ml-auto text-[10px] text-slate-500">
              {openRows.length} open{openRows.filter((d) => d.phase === "undated").length ? ` · ${openRows.filter((d) => d.phase === "undated").length} undated` : ""}{handledRows.length ? ` · ${handledRows.length} done this fortnight below` : ""}
            </span>
          </div>
          {openRows.length === 0 && <p className="px-3.5 py-3 text-[11px] text-slate-500">Nothing outstanding.</p>}
          {openRows.map(needsRow)}
          {handledRows.length > 0 && (
            <div className="border-t border-slate-800/70">
              <button onClick={() => setDoneOpen((v) => !v)} className="w-full flex items-center gap-2 px-3.5 py-2 text-[11px] text-slate-500 hover:text-slate-300 text-left">
                <span className="text-slate-600">{doneOpen ? "▾" : "▸"}</span>
                <b className="text-slate-400">{handledRows.length} done this fortnight</b>
                {!doneOpen && <span className="truncate text-slate-600">{handledRows.slice(0, 3).map((d) => `${d.title}${d.mergedCount > 1 ? ` ×${d.mergedCount}` : ""}`).join(" · ")}</span>}
                <span className="ml-auto text-[9px] uppercase tracking-wider text-slate-600">show · undo</span>
              </button>
              {doneOpen && handledRows.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-3.5 py-1.5 border-t border-slate-800/50 opacity-60">
                  <span className={`w-[82px] flex-shrink-0 text-center rounded-md border py-0.5 text-[9px] font-bold uppercase tracking-wider font-mono ${PHASE_TONE[d.phase]}`}>{phaseText(d)}</span>
                  <span className="flex-1 min-w-0 text-[12px] text-slate-400 line-through truncate">{d.title}{d.mergedCount > 1 ? ` ×${d.mergedCount}` : ""}</span>
                  <Who id={d.personId} small />
                  <button onClick={() => setState(d, "open")} disabled={saving !== null} className="text-[9px] uppercase tracking-wider text-slate-500 hover:text-slate-200 disabled:opacity-40">undo</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4 items-start">
        {/* ── per person (F4, F5, F7) ── */}
        <div className="space-y-4">
          {Array.from(personById.values()).map((e) => {
            // Iterate the ROSTER, not the model's output: a child with tracked
            // deadlines but no brief this pass still gets a card.
            const pd = digest.people?.find((p) => p.personId === e.person.id) ?? null;
            const mineOpen = openRows.filter((d) => d.personId === e.person.id);
            const mineLate = mineOpen.filter((d) => d.phase === "lapsed").length;
            const mineEvents = events.filter((ev) => ev.personId === e.person.id);
            const lastHandled = handledRows.filter((d) => d.personId === e.person.id).sort((a, b) => (b.stateAt ?? "").localeCompare(a.stateAt ?? ""))[0];
            const quiet = !pd?.summary && mineOpen.length === 0 && mineEvents.length === 0;
            return (
              <div key={e.person.id} id={`family-person-${e.person.id}`} className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden scroll-mt-24">
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-800 bg-slate-800/30">
                  <span className={`w-7 h-7 rounded-lg border flex items-center justify-center text-xs font-bold flex-shrink-0 ${e.tint.av}`}>{e.person.name.charAt(0)}</span>
                  <span className="min-w-0">
                    <span className="text-[13px] font-bold text-slate-100">{e.person.name}</span>
                    <span className="text-[10.5px] text-slate-500">
                      {[e.person.grade && `${e.person.grade} grade`, e.person.school].filter(Boolean).map((x) => ` · ${x}`).join("")}
                    </span>
                  </span>
                  <span className="ml-auto text-[10px] font-mono text-slate-500 whitespace-nowrap">
                    {quiet ? "nothing this fortnight" : (
                      <>
                        {pd?.updatedAt ? `updated ${ago(pd.updatedAt, nowMs)}` : pd?.stale ? "last brief" : ""}
                        {pd?.newMail ? <span className="text-emerald-400"> · {pd.newMail} new</span> : null}
                        {mineOpen.length > 0 && <span className={mineLate ? "text-red-300" : "text-amber-300"}> · {mineOpen.length} open{mineLate ? ` · ${mineLate} late` : ""}</span>}
                      </>
                    )}
                  </span>
                </div>
                {pd?.stale && (
                  <p className="px-3.5 pt-2 text-[10.5px] text-amber-300/90">Summary unavailable this pass — this is the last brief; the items below are from the record.</p>
                )}
                {pd?.summary ? (
                  <p className="px-3.5 py-3 text-[12.5px] text-slate-300 leading-relaxed">
                    {pd.summary}
                    {pd.whatsNew && (
                      <span className="block mt-1.5 pl-2 border-l-2 border-emerald-400/70 bg-emerald-500/[0.06] text-slate-200 rounded-r">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 mr-1.5">new since you last looked</span>{pd.whatsNew}
                      </span>
                    )}
                  </p>
                ) : quiet ? (
                  <p className="px-3.5 py-3 text-[11.5px] text-slate-500">
                    No mail from {e.person.name}&rsquo;s senders in the last {digest.coverage.windowDays} days.
                    {lastHandled && <> The last noted item was &ldquo;{lastHandled.title}&rdquo; ({lastHandled.phase === "done" ? "done" : "not theirs"}).</>}
                  </p>
                ) : !pd && digest.briefFailed ? (
                  <p className="px-3.5 py-3 text-[11.5px] text-amber-300/90">Summary unavailable — the model call failed; the items below are from the record.</p>
                ) : null}
                {mineOpen.length > 0 && (
                  <div className="border-t border-slate-800/60 px-3.5 py-2">
                    {mineOpen.slice(0, 5).map((d) => (
                      <div key={d.id} className="flex items-baseline gap-2.5 py-1 text-[11.5px]">
                        <span className={`w-[78px] flex-shrink-0 text-center rounded border py-px text-[9px] font-bold uppercase tracking-wider font-mono ${PHASE_TONE[d.phase] ?? PHASE_TONE.open}`}>{phaseText(d)}</span>
                        <span className="min-w-0 text-slate-300 truncate">{d.title}{isNewSince(d, lastVisitMs) && <span className={NEW_CHIP}>new</span>}</span>
                      </div>
                    ))}
                    {mineOpen.length > 5 && <p className="text-[10px] text-slate-600 pt-1">+{mineOpen.length - 5} more above in Needs you</p>}
                  </div>
                )}
                {mineEvents.length > 0 && (
                  <div className="border-t border-slate-800/60 px-3.5 py-2">{mineEvents.map(eventLine)}</div>
                )}
              </div>
            );
          })}

          {(digest.household || events.some((ev) => !ev.personId)) && (
            <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-800 bg-slate-800/30">
                <span className="w-7 h-7 rounded-lg border border-teal-500/35 bg-teal-500/14 text-teal-300 flex items-center justify-center text-xs flex-shrink-0">⌂</span>
                <span className="text-[13px] font-bold text-slate-100">Household</span>
                <span className="text-[10.5px] text-slate-500">· appointments, travel &amp; family mail</span>
              </div>
              {digest.household && <p className="px-3.5 py-3 text-[12.5px] text-slate-300 leading-relaxed">{digest.household}</p>}
              {events.some((ev) => !ev.personId) && (
                <div className="border-t border-slate-800/60 px-3.5 py-2">{events.filter((ev) => !ev.personId).map(eventLine)}</div>
              )}
            </div>
          )}
        </div>

        {/* ── while you are away (F6) + coverage ── */}
        <div className="space-y-4">
          {away && (
            <div className="border border-violet-500/40 bg-violet-950/10 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3.5 py-2 border-b border-violet-500/25 bg-violet-500/[.06]">
                <span className="text-[11px] font-bold uppercase tracking-widest text-violet-300">✈ While you are away</span>
                <span className="ml-auto text-[10px] text-slate-500">for the call home</span>
              </div>
              <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800/70 text-[11.5px] text-slate-300 flex-wrap">
                <b className="text-slate-100">{away.status === "on" ? "TDY" : "Next"} · {away.trip.label}</b>
                <span className="font-mono text-[10px] text-slate-500">{fmtShort(away.trip.startDate)} → {fmtShort(away.trip.endDate)}{away.day ? ` · day ${away.day} of ${away.days}` : ` · in ${Math.max(0, Math.round((Date.parse(`${away.trip.startDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000))} d`}</span>
              </div>
              {away.happened.length > 0 && (
                <>
                  <p className="px-3.5 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Happened since you left</p>
                  {away.happened.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 px-3.5 py-1 text-[11.5px] text-slate-300">
                      <span className="w-[48px] flex-shrink-0 font-mono text-[10px] text-slate-600 line-through">{fmtShort(r.dateISO)}</span>
                      <span className="flex-1 min-w-0 truncate">{r.title}</span>
                      <Who id={r.personId} small />
                    </div>
                  ))}
                </>
              )}
              {away.ahead.length > 0 && (
                <>
                  <p className="px-3.5 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{away.status === "on" ? "Before you are back" : "While you will be away"}</p>
                  {away.ahead.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 px-3.5 py-1 text-[11.5px] text-slate-200">
                      <span className="w-[48px] flex-shrink-0 font-mono text-[10px] text-slate-400">{fmtShort(r.dateISO)}</span>
                      <span className="flex-1 min-w-0 truncate">{r.title}</span>
                      <Who id={r.personId} small />
                    </div>
                  ))}
                </>
              )}
              {away.happened.length === 0 && away.ahead.length === 0 && <p className="px-3.5 py-3 text-[11px] text-slate-500">Nothing dated lands inside this trip.</p>}
              <div className="flex items-center gap-2 px-3.5 py-2 border-t border-slate-800/70 text-[9.5px] text-slate-600">
                dated items inside the trip only — nothing guessed
                {awayCount > 0 && <button onClick={copyAway} className="ml-auto text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-violet-300">⧉ copy as a list</button>}
              </div>
            </div>
          )}

          <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
            <div className="px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">✓ Coverage</span>
            </div>
            <div className="px-3.5 py-2.5 text-[11px] text-slate-300 leading-relaxed">
              {digest.coverage.scanned} family email{digest.coverage.scanned === 1 ? "" : "s"} from the last {digest.coverage.windowDays} days read, across{" "}
              {digest.coverage.senders} watched sender{digest.coverage.senders === 1 ? "" : "s"}.
              {digest.empty === "no-mail" && <span className="text-slate-500"> Nothing has arrived in this window.</span>}
              {!digest.briefFailed && !digest.disabled && digest.coverage.scanned > 0 && <span className="text-slate-500"> Nothing missed.</span>}
              <button onClick={() => setRosterOpen(true)} className="block mt-2 text-[10px] font-bold uppercase tracking-wider text-emerald-400/80 hover:text-emerald-300">Edit roster &amp; senders →</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── proposals + discovery, below the content (F8, F9) ── */}
      <div id="family-proposals" className="scroll-mt-24">
        {digest.proposals && <ProposalsCard proposals={digest.proposals} accountEmail={undefined} onChanged={() => { setRoster(null); load(true); }} />}
      </div>
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
            exclude={["biller"]}
          />
        </div>
      </details>
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
