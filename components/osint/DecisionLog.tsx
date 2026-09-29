"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CALLS, CALL_GLYPH, CALL_LABEL, HORIZONS, MAX_EXPECTATION_LEN, OUTCOMES,
  daysUntilDue, isDue, isOpen, validateDraft,
  type DecisionCall, type DecisionEntry, type DecisionOutcome, type HitRate,
} from "@/lib/decisionLog";
import { toast } from "@/lib/feedback";
import { calibrationProposals, type IndicatorCalibration } from "@/lib/indicatorCalibration";

// The decision log, inline on the I&W problem card — where the evidence is.
//
// warningTaxonomy.ts already requires every indicator to carry a pre-registered
// FALSIFIER, on the doctrine that an indicator you cannot be wrong about is not
// an indicator. But nothing recorded a call or ever checked one, so those
// falsifiers were decoration. This is the loop: log a read with an expectation
// and a horizon; at the horizon the board asks you to score it.
//
// Honest about its own weight: a prediction you score yourself is weak
// evidence, and the app never scores for you — it only reopens the entry. The
// value is that writing the expectation down beforehand turns a feeling into
// something falsifiable, and re-reading it later is the only way to notice an
// indicator you keep being wrong about.

const CALL_TONE: Record<DecisionCall, string> = {
  escalating: "text-red-300 border-red-500/45 bg-red-500/10",
  holding: "text-slate-300 border-slate-600 bg-slate-700/20",
  deescalating: "text-emerald-300 border-emerald-500/45 bg-emerald-500/10",
};
const OUTCOME_TONE: Record<DecisionOutcome, string> = {
  right: "text-emerald-300 border-emerald-500/45",
  wrong: "text-red-300 border-red-500/45",
  ambiguous: "text-slate-400 border-slate-600",
};

export default function DecisionLog({
  problemId, indicatorIds, indicatorLabel,
}: {
  problemId: string;
  indicatorIds: string[];
  indicatorLabel: (id: string) => string;
}) {
  const [entries, setEntries] = useState<DecisionEntry[]>([]);
  const [rate, setRate] = useState<HitRate | null>(null);
  // Per-indicator calibration from the same scored entries — which
  // indicators are earning their place. Proposals only; nothing re-weights.
  const [calibration, setCalibration] = useState<IndicatorCalibration[]>([]);
  const [calOpen, setCalOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Draft
  const [call, setCall] = useState<DecisionCall>("escalating");
  const [indicatorId, setIndicatorId] = useState("");
  const [expectation, setExpectation] = useState("");
  const [horizonDays, setHorizonDays] = useState<number>(14);

  // Scoring
  const [scoring, setScoring] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    fetch(`/api/warning/decision?problemId=${encodeURIComponent(problemId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.entries)) setEntries(d.entries);
        if (d?.hitRate) setRate(d.hitRate);
        if (Array.isArray(d?.calibration)) setCalibration(d.calibration);
      })
      .catch(() => {});
  }, [problemId]);

  useEffect(() => { load(); }, [load]);

  const due = entries.filter((e) => isDue(e));
  const openCount = entries.filter(isOpen).length;
  const proposals = calibrationProposals(calibration);

  const submit = async () => {
    const draft = { problemId, call, expectation: expectation.trim(), horizonDays };
    const v = validateDraft(draft);
    if (v) { setErr(v); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/warning/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, indicatorId: indicatorId || null }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Could not save the call.");
      setExpectation(""); setIndicatorId(""); setAdding(false);
      toast.ok("Call logged", `reopens for scoring in ${horizonDays} days`);
      load();
    } catch (e) {
      toast.error("Could not save the call", e);
      setErr(e instanceof Error ? e.message : "Could not save the call.");
    } finally { setBusy(false); }
  };

  const score = async (id: string, outcome: DecisionOutcome) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/warning/decision", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, outcome, note: note.trim() || undefined }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Could not score it.");
      setScoring(null); setNote("");
      toast.ok(`Scored ${outcome}`, "scoring is one-way — the record is what you thought at the time");
      load();
    } catch (e) {
      toast.error("Could not score it", e);
      setErr(e instanceof Error ? e.message : "Could not score it.");
    } finally { setBusy(false); }
  };

  return (
    <div className="border-t border-slate-800 pt-2 mt-1">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
        <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-600">Decision log</span>
        {due.length > 0 && (
          <span className="text-[8px] font-bold uppercase tracking-wider px-1 rounded border text-amber-300 border-amber-500/45 bg-amber-500/10">
            {due.length} to score
          </span>
        )}
        {rate && <span className="text-[9px] font-mono text-slate-500">{rate.label}</span>}
        {proposals.length > 0 && (
          <span className="text-[8px] font-bold uppercase tracking-wider px-1 rounded border text-orange-300 border-orange-500/45 bg-orange-500/10">
            {proposals.length} to re-weight
          </span>
        )}
        <span className="ml-auto text-[10px] text-slate-600">{openCount > 0 ? `${openCount} open · ` : ""}{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {err && <p className="text-[10px] text-red-400">{err}</p>}

          {/* Calibration — the log read per indicator. Proposals lead and are
              always visible; the full table folds. The board proposes, the
              analyst disposes: nothing here changes a weight. */}
          {calibration.length > 0 && (
            <div className={`border rounded-lg px-2.5 py-2 ${proposals.length ? "border-orange-500/35 bg-orange-500/[0.04]" : "border-slate-800 bg-slate-950/40"}`}>
              <button onClick={() => setCalOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
                <span className="text-[8.5px] font-bold uppercase tracking-[0.14em] text-slate-500">Indicator calibration</span>
                <span className="text-[9px] font-mono text-slate-600">
                  {proposals.length ? `${proposals.length} proposed for down-weighting` : `${calibration.length} indicator${calibration.length === 1 ? "" : "s"} with scored calls — none flagged`}
                </span>
                <span className="ml-auto text-[10px] text-slate-600">{calOpen ? "▾" : "▸"}</span>
              </button>
              {proposals.map((c) => (
                <p key={c.indicatorId} className="text-[10.5px] text-orange-200/90 mt-1 leading-snug">
                  <span className="font-bold">{indicatorLabel(c.indicatorId)}</span> — {c.evidence}
                </p>
              ))}
              {calOpen && (
                <div className="mt-1.5 space-y-1 border-t border-slate-800/60 pt-1.5">
                  {calibration.filter((c) => c.verdict !== "downweight").map((c) => (
                    <p key={c.indicatorId} className="text-[10px] text-slate-400 leading-snug">
                      <span className={`font-bold ${c.verdict === "earning" ? "text-emerald-300" : "text-slate-300"}`}>{indicatorLabel(c.indicatorId)}</span> — {c.evidence}
                    </p>
                  ))}
                  <p className="text-[9px] text-slate-600">Computed from calls scored against ONE indicator. Whole-board calls are excluded. Weights in the taxonomy are never changed automatically — this is a proposal with its evidence.</p>
                </div>
              )}
            </div>
          )}

          {entries.length === 0 && !adding && (
            <p className="text-[10px] text-slate-600 leading-snug">
              Nothing logged yet. A call recorded with an expectation and a horizon is what makes this board&apos;s
              pre-registered falsifiers mean something — without one, an indicator cannot be wrong.
            </p>
          )}

          {entries.map((e) => {
            const d = daysUntilDue(e);
            const dueNow = isDue(e);
            return (
              <div key={e.id} className={`border rounded-lg px-2.5 py-2 ${dueNow ? "border-amber-500/40 bg-amber-500/[0.05]" : "border-slate-800 bg-slate-950/40"}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[8.5px] font-bold uppercase tracking-wider px-1 rounded border ${CALL_TONE[e.call]}`}>
                    {CALL_GLYPH[e.call]} {CALL_LABEL[e.call]}
                  </span>
                  {e.indicatorId && <span className="text-[9px] font-mono text-slate-500">{indicatorLabel(e.indicatorId)}</span>}
                  {e.outcome
                    ? <span className={`text-[8.5px] font-bold uppercase tracking-wider px-1 rounded border ${OUTCOME_TONE[e.outcome]}`}>{e.outcome}</span>
                    : <span className="text-[9px] font-mono text-slate-500">
                        {d === null ? "horizon unknown" : dueNow ? `due ${d === 0 ? "today" : `${-d}d ago`}` : `${d}d left`}
                      </span>}
                  <span className="ml-auto text-[9px] font-mono text-slate-600">{e.horizonDays}d horizon</span>
                </div>

                <p className="text-[11.5px] text-slate-300 mt-1 leading-snug">{e.expectation}</p>
                {e.scoreNote && <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">— {e.scoreNote}</p>}

                {dueNow && scoring !== e.id && (
                  <button onClick={() => { setScoring(e.id); setNote(""); }} className="mt-1.5 text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-amber-500/45 text-amber-300 hover:bg-amber-500/10">
                    Score it
                  </button>
                )}

                {scoring === e.id && (
                  <div className="mt-1.5 space-y-1.5">
                    <input
                      value={note}
                      onChange={(ev) => setNote(ev.target.value)}
                      placeholder="What actually happened (optional)"
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600"
                    />
                    <div className="flex items-center gap-1.5">
                      {OUTCOMES.map((o) => (
                        <button key={o} onClick={() => score(e.id, o)} disabled={busy}
                          className={`text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border disabled:opacity-40 ${OUTCOME_TONE[o]} hover:bg-slate-800/50`}>
                          {o}
                        </button>
                      ))}
                      <button onClick={() => setScoring(null)} className="ml-auto text-[9px] uppercase tracking-wider text-slate-600 hover:text-slate-400">cancel</button>
                    </div>
                    <p className="text-[9px] text-slate-600">Scoring is one-way — the record is what you thought at the time.</p>
                  </div>
                )}
              </div>
            );
          })}

          {adding ? (
            <div className="border border-slate-700 rounded-lg px-2.5 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                {CALLS.map((c) => (
                  <button key={c} onClick={() => setCall(c)}
                    className={`text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border ${c === call ? CALL_TONE[c] : "border-slate-700 text-slate-500"}`}>
                    {CALL_GLYPH[c]} {CALL_LABEL[c]}
                  </button>
                ))}
                <select value={indicatorId} onChange={(e) => setIndicatorId(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-300">
                  <option value="">whole board</option>
                  {indicatorIds.map((id) => <option key={id} value={id}>{indicatorLabel(id)}</option>)}
                </select>
              </div>
              <textarea
                value={expectation}
                onChange={(e) => setExpectation(e.target.value.slice(0, MAX_EXPECTATION_LEN))}
                rows={2}
                placeholder="What do you expect to see? (this is the part you score later)"
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600"
              />
              <div className="flex items-center gap-1.5">
                {HORIZONS.map((h) => (
                  <button key={h} onClick={() => setHorizonDays(h)}
                    className={`text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border ${h === horizonDays ? "border-sky-500/50 bg-sky-500/10 text-sky-300" : "border-slate-700 text-slate-500"}`}>
                    {h}d
                  </button>
                ))}
                <button onClick={submit} disabled={busy}
                  className="ml-auto text-[9px] font-bold uppercase tracking-wider rounded px-2.5 py-1 border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 disabled:opacity-40">
                  {busy ? "…" : "Log call"}
                </button>
                <button onClick={() => { setAdding(false); setErr(null); }} className="text-[9px] uppercase tracking-wider text-slate-600 hover:text-slate-400">cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-400 hover:text-slate-200">
              ＋ Log a call
            </button>
          )}
        </div>
      )}
    </div>
  );
}
