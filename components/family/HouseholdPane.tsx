"use client";

import { useCallback, useEffect, useState } from "react";
import type { HouseholdDigest } from "@/lib/household";
import { formatUsdCents, runwayPct } from "@/lib/householdSignals";
import { toast } from "@/lib/feedback";
import SenderDiscoveryCard from "@/components/family/SenderDiscoveryCard";
import ProposalsCard from "@/components/family/ProposalsCard";


// Household: bills, documents and the admin that keeps people well.
//
// Organised around what has no alarm attached. Autopay reminds itself, so
// manual bills lead. A subscription renews silently, so an amount that moved
// is called out. A passport expires with no notice, so runway is drawn. And a
// bill that STOPS arriving raises nothing at all, which is why absence gets
// its own panel rather than being inferred from an empty list.

const fmtDay = (iso: string | null): string => {
  if (!iso) return "No date";
  const d = new Date(`${iso}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return "No date";
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

function dueChip(iso: string | null, nowMs: number): { text: string; cls: string } {
  if (!iso) return { text: "No date", cls: "text-slate-400 bg-slate-700/40 border-slate-600" };
  const d = Math.ceil((Date.parse(`${iso}T23:59:59Z`) - nowMs) / 86_400_000);
  if (!Number.isFinite(d)) return { text: "No date", cls: "text-slate-400 bg-slate-700/40 border-slate-600" };
  if (d < 0) return { text: "Overdue", cls: "text-red-200 bg-red-500/25 border-red-500/60" };
  if (d <= 3) return { text: d === 0 ? "Today" : `${d}d`, cls: "text-red-200 bg-red-500/20 border-red-500/50" };
  if (d <= 10) return { text: `${d}d`, cls: "text-amber-200 bg-amber-500/16 border-amber-500/42" };
  return { text: fmtDay(iso).replace(/^\w+,?\s*/, ""), cls: "text-emerald-200/80 bg-emerald-500/10 border-emerald-500/30" };
}

const RUNWAY_BAR: Record<string, string> = {
  red: "bg-gradient-to-r from-red-500 to-red-400",
  amber: "bg-gradient-to-r from-amber-500 to-amber-400",
  calm: "bg-gradient-to-r from-emerald-600 to-emerald-500",
};
const SEV_DOT: Record<string, string> = { red: "bg-red-500", amber: "bg-amber-500", calm: "bg-emerald-500" };

export default function HouseholdPane({ active, autoDiscover = false }: { active: boolean; autoDiscover?: boolean }) {
  const [d, setD] = useState<HouseholdDigest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => { setNowMs(Date.now()); }, []);

  const load = useCallback((refresh = false) => {
    setLoading(true);
    setError(null);
    fetch(`/api/family/household${refresh ? "?refresh=1" : ""}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || j.error) throw new Error(j?.error || `Request failed (${r.status})`);
        setD(j);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load household mail"))
      .finally(() => setLoading(false));
  }, []);

  // Same error guard as the school pane: without it a failed request retries
  // forever, each pass costing a Gmail fetch and a model call.

  useEffect(() => {
    if (!active || d || loading || error) return;
    load();
  }, [active, d, loading, error, load]);

  if (error && !d) {
    return (
      <div className="max-w-md mx-auto py-14 text-center">
        <p className="text-sm text-red-300 mb-1.5">Couldn&rsquo;t load the household digest.</p>
        <p className="text-[11px] text-slate-500 mb-4">{error}</p>
        <button onClick={() => load()} className="text-xs font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded-md px-4 py-2 hover:bg-emerald-500/10">Retry</button>
      </div>
    );
  }
  if (!d && loading) {
    return <div className="py-14 text-center text-xs text-slate-600 font-mono uppercase tracking-widest animate-pulse">Reading household mail…</div>;
  }
  if (d?.empty === "no-billers") {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <p className="text-sm text-slate-300 mb-1.5">No billers declared yet.</p>
        <p className="text-xs text-slate-500 leading-relaxed mb-4">
          Add billers and documents under <b className="text-slate-400">Roster</b>, or let the scan below propose
          them. A biller&rsquo;s cadence is learned from its statements once four agree; the silence watch stays
          quiet until then. Documents come from a renewal notice the tab read, or are typed in once.
        </p>
        <div className="text-left">
          <SenderDiscoveryCard
            heading="⌕ Find billers I have not declared"
            intro="You cannot be reminded of a bill you forgot you had."
            onAccepted={() => load(true)}
            autoDiscover={autoDiscover}
          />
        </div>
      </div>
    );
  }
  if (!d) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <p className="text-[10px] text-slate-600 flex-1">
          bills, documents &amp; wellbeing — organised around what has no alarm attached
        </p>
        <button onClick={() => load(true)} disabled={loading} className="text-[10px] font-mono text-slate-500 hover:text-emerald-400 disabled:opacity-40">
          {loading ? "…" : "↻"}
        </button>
      </div>

      {d.disabled && (
        <p className="text-[11px] text-amber-300/90 border border-amber-500/30 bg-amber-500/5 rounded-lg px-3 py-2">
          Family digest is off in Preferences → AI Controls. Amounts and wellbeing need the model; the silence
          watch and document runway below are computed without it and remain accurate.
        </p>
      )}

      {/* ── money due ── */}
      {d.bills.length > 0 && (
        <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
            <span className="text-[11px] font-bold uppercase tracking-widest text-red-300/90">◧ Money due</span>
            <span className="ml-auto text-[10px] text-slate-600">manual first — autopay shown for completeness</span>
          </div>
          {d.bills.map((b) => {
            const chip = dueChip(b.dueISO, nowMs);
            return (
              <div key={b.billerId} className="flex items-center gap-3 px-3.5 py-2.5 border-t border-slate-800/60 first:border-t-0">
                <span className="w-[86px] flex-shrink-0 text-right font-mono text-[14px] font-bold text-slate-100">
                  {formatUsdCents(b.amountCents)}
                </span>
                <span className={`w-[70px] flex-shrink-0 text-center rounded-md border py-1 text-[9.5px] font-bold uppercase tracking-wider font-mono ${chip.cls}`}>
                  {chip.text}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-bold text-slate-100 truncate">{b.label}</span>
                  <span className="block text-[10.5px] text-slate-500 truncate">
                    {b.accountMask && <>Account {b.accountMask} · </>}
                    {b.note || b.sourceLabel}
                  </span>
                </span>
                {b.notable && b.delta && (
                  <span className="flex-shrink-0 text-[9.5px] font-bold text-amber-400" title={`vs a ${b.delta.samples}-statement average of ${formatUsdCents(b.delta.averageCents)}`}>
                    {b.delta.pct > 0 ? "▲" : "▼"} {Math.abs(b.delta.pct)}% vs avg
                  </span>
                )}
                {d.cadences?.[b.billerId] && (
                  <span className="flex-shrink-0 text-[9px] font-mono text-slate-500 hidden sm:inline" title={d.cadences[b.billerId].label}>
                    {d.cadences[b.billerId].cadence ?? "learning"}{d.cadences[b.billerId].source === "observed" ? " ·obs" : ""}
                  </span>
                )}
                <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider border rounded-full px-2.5 py-0.5 ${
                  b.autopay ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/8" : "text-orange-300 border-orange-500/45 bg-orange-500/10"
                }`}>
                  {b.autopay ? "Autopay" : "Manual"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── proposals mined from the bill mail itself (same model call) ── */}
      {d.proposals && <ProposalsCard proposals={d.proposals} onChanged={() => load(true)} />}

      {/* ── discovery — shared with the School pane (SenderDiscoveryCard) ── */}
      <SenderDiscoveryCard
        heading="⌕ Find billers I have not declared"
        intro="You cannot be reminded of a bill you forgot you had — everything else on this pane only looks at senders you named."
        onAccepted={() => load(true)}
        autoDiscover={autoDiscover}
      />

      {/* ── account jeopardy ──
          First, because it is the only block here where something is already
          going wrong rather than merely worth watching. Deterministic (no model
          call), so it survives an AI outage — see lib/accountJeopardy. */}
      {(d.jeopardy?.length ?? 0) > 0 && (
        <div className="border border-red-500/40 bg-red-950/15 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-red-500/25 bg-red-500/[.07]">
            <span className="text-[11px] font-bold uppercase tracking-widest text-red-300">⚠ Needs action now</span>
            <span className="ml-auto text-[10px] text-slate-500">{d.jeopardyLine}</span>
          </div>
          {d.jeopardy.map((f) => (
            <div key={f.sourceId} className="flex items-start gap-3 px-3.5 py-2 border-t border-slate-800/70 first:border-t-0">
              <span className={`mt-0.5 w-[74px] flex-shrink-0 text-center text-[9px] font-bold uppercase tracking-wider rounded py-0.5 border ${
                f.severity === "red"
                  ? "text-red-200 border-red-500/55 bg-red-500/15"
                  : "text-amber-200 border-amber-500/45 bg-amber-500/10"
              }`}>
                {f.kind.replace(/-/g, " ")}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-100">{f.label}</span>
                <span className="block text-[10.5px] text-slate-500">
                  {f.meaning} · matched &ldquo;{f.phrase}&rdquo;{f.seenDate ? ` · ${f.seenDate}` : ""}
                </span>
              </span>
            </div>
          ))}
          <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
            A fixed phrase scan over mail from the billers you declared — no model call, so it still works when AI
            is off. It can only see senders you named, so an empty block is not an all-clear.
          </p>
        </div>
      )}

      {/* ── expected documents ──
          The silence watch generalised past billers: a W-2 or report card is
          expected ONCE by a date and has no cadence, so nothing was watching. */}
      {(d.expected?.length ?? 0) > 0 && (
        <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">⬒ Expected documents</span>
            <span className="ml-auto text-[10px] text-slate-600">{d.expectedLine}</span>
          </div>
          {d.expected.map((r) => (
            <div key={r.expectation.id} className="flex items-start gap-3 px-3.5 py-2 border-t border-slate-800/50 first:border-t-0">
              <span className={`mt-0.5 w-[66px] flex-shrink-0 text-center text-[9px] font-bold uppercase tracking-wider rounded py-0.5 border ${
                r.status === "overdue" ? "text-red-200 border-red-500/55 bg-red-500/15"
                : r.status === "pending" ? "text-amber-300 border-amber-500/45 bg-amber-500/10"
                : r.status === "unknown" ? "text-slate-400 border-slate-600 bg-slate-700/30"
                : "text-emerald-300 border-emerald-500/45 bg-emerald-500/10"
              }`}>
                {r.status}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-100">{r.expectation.label}</span>
                <span className="block text-[10.5px] text-slate-500">{r.reason}</span>
                {r.expectation.note && <span className="block text-[9.5px] text-slate-600 mt-0.5">{r.expectation.note}</span>}
              </span>
            </div>
          ))}
          <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
            Matched on the phrase you declared, against mail from senders you declared. An expectation whose sender is
            not in your roster will read <span className="font-mono">unknown</span>, never overdue — a search that did
            not look must not accuse anyone of not writing.
          </p>
        </div>
      )}

      {/* ── what the history says ──
          Two reads ALONG the sighting series, which nothing did before: the
          store was only ever asked "did it arrive?" and "is this one unusual?".
          Both stay silent below their sample floors. */}
      {((d.cadenceDrift?.length ?? 0) > 0 || (d.creep?.length ?? 0) > 0) && (
        <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
            <span className="text-[11px] font-bold uppercase tracking-widest text-sky-300">◷ What the history says</span>
            <span className="ml-auto text-[10px] text-slate-600">from your own bill sightings · no model call</span>
          </div>

          {d.creep?.map((c) => (
            <div key={`creep-${c.biller.id}`} className="flex items-start gap-3 px-3.5 py-2 border-t border-slate-800/50 first:border-t-0">
              <span className="mt-0.5 w-[60px] flex-shrink-0 text-center text-[9px] font-bold uppercase tracking-wider rounded py-0.5 border text-amber-300 border-amber-500/45 bg-amber-500/10">
                creep
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-100">{c.biller.label}</span>
                <span className="block text-[10.5px] text-slate-500">
                  {formatUsdCents(c.firstCents)} → {formatUsdCents(c.lastCents)} · {c.reason}
                </span>
              </span>
            </div>
          ))}

          {d.cadenceDrift?.map((o) => (
            <div key={`cad-${o.biller.id}`} className="flex items-start gap-3 px-3.5 py-2 border-t border-slate-800/50">
              <span className="mt-0.5 w-[60px] flex-shrink-0 text-center text-[9px] font-bold uppercase tracking-wider rounded py-0.5 border text-slate-300 border-slate-600 bg-slate-700/30">
                cadence
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-100">{o.biller.label}</span>
                <span className="block text-[10.5px] text-slate-500">{o.reason}</span>
                <span className="block text-[9.5px] text-slate-600 mt-0.5">
                  The declared cadence is what lets the silence watch tell &ldquo;{o.biller.cadence}&rdquo; from
                  &ldquo;stopped&rdquo; — worth correcting in the roster.
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── silence watch ── */}
      {d.silence.length > 0 && (
        <div className="border border-violet-500/40 bg-violet-950/10 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-violet-500/25 bg-violet-500/[.07]">
            <span className="text-[11px] font-bold uppercase tracking-widest text-violet-300">◌ Silence watch — expected, not seen</span>
            <span className="ml-auto text-[10px] text-slate-600">a bill that stops arriving raises no alarm on its own</span>
          </div>
          {d.silence.map((s) => (
            <div key={s.biller.id} className="flex items-center gap-3 px-3.5 py-2.5 border-t border-slate-800/60 first:border-t-0">
              <span className="w-[86px] flex-shrink-0 text-center rounded-md border border-violet-500/45 bg-violet-500/12 text-violet-200 py-1 text-[9.5px] font-bold uppercase tracking-wider font-mono">
                {s.missedCycles > 1 ? `${s.missedCycles} cycles` : `${s.daysQuiet}d quiet`}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-bold text-slate-100">{s.biller.label}</span>
                <span className="block text-[10.5px] text-slate-500">
                  {d.cadences?.[s.biller.id]?.label ?? s.biller.cadence} cadence · last seen {fmtDay(s.lastSeenISO)}. Paperless lapse, address change, or autopay cancelled?
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* ── expiring ── */}
        {d.documents.length > 0 && (
          <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">⧗ Expiring — nothing will remind you</span>
            </div>
            {d.documents.map((r) => (
              <div key={r.doc.id} className="px-3.5 py-2.5 border-t border-slate-800/60 first:border-t-0">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 text-[12.5px] font-semibold text-slate-200 truncate">{r.doc.label}</span>
                  <span className="font-mono text-[10.5px] text-slate-500">{r.doc.expiresISO}</span>
                </div>
                <div className="h-[5px] rounded-sm bg-slate-800 mt-1.5 overflow-hidden">
                  <span className={`block h-full rounded-sm ${RUNWAY_BAR[r.level]}`} style={{ width: `${runwayPct(r.actionableDaysLeft)}%` }} />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  {r.actionableDaysLeft < 0 ? (
                    <span className="text-red-300 font-semibold">
                      Past its usable window by {Math.abs(r.actionableDaysLeft)} days — expiry is {r.daysLeft} days out.
                    </span>
                  ) : (
                    <>{r.actionableDaysLeft} days of usable runway{r.doc.leadDays ? ` (expiry ${r.daysLeft}d, ${r.doc.leadDays}d lead)` : ""}.</>
                  )}
                  {r.doc.note && <> {r.doc.note}</>}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ── wellbeing ── */}
        {d.wellbeing.length > 0 && (
          <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">✚ Health &amp; wellbeing</span>
              <span className="ml-auto text-[10px] text-slate-600">the admin that keeps people well</span>
            </div>
            {d.wellbeing.map((w, i) => (
              <div key={i} className="flex items-start gap-2.5 px-3.5 py-2 border-t border-slate-800/55 first:border-t-0">
                <span className={`w-[7px] h-[7px] rounded-full mt-[5px] flex-shrink-0 ${SEV_DOT[w.severity]}`} />
                <p className="text-[11.5px] text-slate-300 leading-relaxed">
                  {w.text}
                  {w.source && <span className="text-[9.5px] text-slate-600 italic"> · {w.source}</span>}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── coverage ── */}
      <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
        <div className="px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">✓ Coverage</span>
        </div>
        <div className="px-3.5 py-2.5 text-[11px] text-slate-300 leading-relaxed space-y-1">
          <p>{d.coverage.billers} biller{d.coverage.billers === 1 ? "" : "s"} watched · {d.coverage.scanned} message{d.coverage.scanned === 1 ? "" : "s"} read in the last {d.coverage.windowDays} days.</p>
          {d.coverage.noCadenceYet > 0 && (
            <p className="text-amber-300/90">
              {d.coverage.noCadenceYet} biller{d.coverage.noCadenceYet === 1 ? " is" : "s are"} still learning
              {d.coverage.noCadenceYet === 1 ? " its" : " their"} cadence (fewer than four statements agree) — the silence
              watch stays quiet about {d.coverage.noCadenceYet === 1 ? "it" : "them"} rather than guessing.
            </p>
          )}
          <p className="text-slate-600 text-[10px]">
            Account numbers are masked to the last four and never stored. Amounts are kept only to compare a bill
            against its own history. Owner-only.
          </p>
        </div>
      </div>
    </div>
  );
}
