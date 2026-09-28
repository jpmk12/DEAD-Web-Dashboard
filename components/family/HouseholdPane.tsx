"use client";

import { useCallback, useEffect, useState } from "react";
import type { HouseholdDigest } from "@/lib/household";
import { formatUsdCents, runwayPct } from "@/lib/householdSignals";
import type { SenderCandidate } from "@/lib/senderDiscovery";

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

export default function HouseholdPane({ active }: { active: boolean }) {
  const [d, setD] = useState<HouseholdDigest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);
  // Discovery is null until the user has scanned at least once — an empty array
  // means "scanned, found nothing", and the two read very differently.
  const [discovery, setDiscovery] = useState<SenderCandidate[] | null>(null);
  const [discovering, setDiscovering] = useState(false);

  const runDiscovery = async () => {
    setDiscovering(true);
    setError(null);
    try {
      const res = await fetch("/api/family/discover", { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Scan failed");
      setDiscovery(Array.isArray(j?.candidates) ? j.candidates : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setDiscovering(false);
    }
  };

  const dismissDomain = async (domain: string) => {
    setDiscovery((prev) => (prev ?? []).filter((c) => c.domain !== domain));
    await fetch(`/api/family/discover?domain=${encodeURIComponent(domain)}`, { method: "DELETE" }).catch(() => {});
  };

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
        <p className="text-xs text-slate-500 leading-relaxed">
          Add billers and documents under <b className="text-slate-400">Roster</b>. Each biller needs a cadence —
          how often it should write — because that is what lets the silence watch tell &ldquo;quarterly&rdquo;
          apart from &ldquo;stopped&rdquo;. Documents are typed in once; a passport expiry never arrives by email.
        </p>
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

      {/* ── discovery ──
          The one search that looks outside the declared roster, so it runs ONLY
          on this button: no poll, no page load, no digest. Headers only (the
          route uses Gmail's metadata format), bounded window, and everything
          already declared is excluded from the query. */}
      <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">⌕ Find billers I have not declared</span>
          <button
            onClick={runDiscovery}
            disabled={discovering}
            className="ml-auto text-[9.5px] font-bold uppercase tracking-wider rounded px-2.5 py-1 border border-sky-500/50 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-40"
          >
            {discovering ? "Scanning…" : "Scan"}
          </button>
        </div>

        {discovery === null ? (
          <p className="px-3.5 py-2 text-[10px] text-slate-600 leading-snug">
            You cannot be reminded of a bill you forgot you had — everything else on this pane only looks at senders
            you named. This checks the last 120 days for billing-shaped subjects from senders you have NOT declared.
            It reads subject lines and addresses only, never message bodies, and runs only when you press Scan.
          </p>
        ) : discovery.length === 0 ? (
          <p className="px-3.5 py-2 text-[10px] text-slate-600 leading-snug">
            Nothing new in the last 120 days. That is not a guarantee there is no undeclared biller — only that none
            wrote with a billing-shaped subject in the window scanned.
          </p>
        ) : (
          <>
            {discovery.map((c) => (
              <div key={c.domain} className="flex items-start gap-3 px-3.5 py-2 border-t border-slate-800/50">
                <span className={`mt-0.5 w-[54px] flex-shrink-0 text-center text-[9px] font-bold uppercase tracking-wider rounded py-0.5 border ${
                  c.kind === "biller" ? "text-amber-300 border-amber-500/45 bg-amber-500/10" : "text-sky-300 border-sky-500/45 bg-sky-500/10"
                }`}>
                  {c.kind}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-semibold text-slate-100">{c.name}</span>
                  <span className="block text-[10px] font-mono text-slate-500">{c.domain}</span>
                  <span className="block text-[10.5px] text-slate-500 mt-0.5">{c.reason}</span>
                  {c.examples.length > 0 && (
                    <span className="block text-[9.5px] text-slate-600 mt-0.5 truncate">e.g. &ldquo;{c.examples[0]}&rdquo;</span>
                  )}
                </span>
                <button
                  onClick={() => dismissDomain(c.domain)}
                  className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-500 hover:text-slate-300"
                >
                  Never
                </button>
              </div>
            ))}
            <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
              These are proposals, not billers — add the ones you want in the roster editor, where you also set the
              cadence the silence watch needs. Declining is permanent.
            </p>
          </>
        )}
      </div>

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
                  {s.biller.cadence} cadence · last seen {fmtDay(s.lastSeenISO)}. Paperless lapse, address change, or autopay cancelled?
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
              {d.coverage.noCadenceYet} biller{d.coverage.noCadenceYet === 1 ? " has" : "s have"} fewer than three
              statements on record — the silence watch stays quiet about {d.coverage.noCadenceYet === 1 ? "it" : "them"}
              {" "}rather than guessing a cadence.
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
