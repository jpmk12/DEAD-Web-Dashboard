"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/feedback";
import { relTime } from "@/lib/relTime";
import type { ProposalsBody } from "@/lib/themeProposalsAssemble";
import type { ThemeProposal } from "@/lib/themeProposals";

// Proposed themes — from your declaration (hub, spokes, ★, areas of interest,
// their chokepoints, watchlist, priority topics), each checked against your
// stored sources before it is shown (lib/themeProposals, no model call).
// Track = the same write as ＋ Theme; Edit = the theme form, filled in;
// Never = permanent and shared.

const FOLD_KEY = "themes.proposals.open";

export default function ProposedThemes({ active, reloadTick, onTracked, onEdit }: {
  active: boolean;
  /** Bumped by the card after a theme write, so the list re-reads. */
  reloadTick: number;
  onTracked: () => void;
  onEdit: (p: ThemeProposal) => void;
}) {
  const [body, setBody] = useState<ProposalsBody | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [why, setWhy] = useState(false);
  useEffect(() => {
    try { const v = localStorage.getItem(FOLD_KEY); if (v != null) setOpen(v === "1"); } catch { /* per-browser convenience */ }
  }, []);
  const toggle = () => setOpen((v) => { try { localStorage.setItem(FOLD_KEY, v ? "0" : "1"); } catch { /* ignore */ } return !v; });

  const load = useCallback(async () => {
    setState((s) => (s === "ok" ? s : "loading"));
    try {
      const r = await fetch("/api/osint/themes/propose", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as ProposalsBody | null;
      if (!r.ok || !j) { setState("error"); return; }
      setBody(j);
      setState("ok");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { if (active) load(); }, [active, reloadTick, load]);

  const act = async (p: ThemeProposal, op: "track" | "dismiss") => {
    setBusy(p.key);
    try {
      const r = await fetch("/api/osint/themes/propose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, key: p.key }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      if (op === "track") { toast.ok(`Tracking “${p.name}”`, typeof j?.backfill === "string" ? j.backfill : undefined); onTracked(); }
      setBody((b) => (b ? { ...b, proposals: b.proposals.filter((x) => x.key !== p.key) } : b));
      if (op === "track") load();
    } catch (e) { toast.error(op === "track" ? "Could not track the theme" : "Could not dismiss", e); }
    finally { setBusy(null); }
  };

  const proposals = body?.proposals ?? [];
  // Nothing to say and nothing wrong: render nothing (the card stays quiet).
  if (state === "ok" && body && body.answered && !proposals.length && !body.note) return null;
  if (state === "idle") return null;

  return (
    <div className="border-b border-slate-800 bg-violet-500/[0.03]" data-testid="proposed-themes">
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-1.5">
        <button type="button" onClick={toggle} aria-expanded={open} className="text-[10px] font-bold uppercase tracking-widest text-violet-300/90 hover:text-violet-200">
          ◇ Proposed themes {proposals.length ? `· ${proposals.length}` : ""} {open ? "▴" : "▾"}
        </button>
        <span className="text-[9.5px] text-slate-600">from your profile, checked against your sources · no model call</span>
        {state === "loading" && <span className="text-[9px] font-mono uppercase text-slate-500">reading…</span>}
        {state === "error" && <span className="text-[9px] text-amber-300">could not read proposals</span>}
        {body?.generatedAt && <span className="ml-auto text-[9px] font-mono text-slate-600">{relTime(body.generatedAt)}</span>}
      </div>
      {open && (
        <div className="px-3.5 pb-2.5 space-y-2">
          {body?.note && <p className={`text-[10.5px] ${body.answered ? "text-slate-500" : "text-amber-300"}`}>{body.note}</p>}
          {body && body.answered && !proposals.length && !body.note && <p className="text-[10.5px] text-slate-500">Nothing new to propose.</p>}
          {proposals.length > 0 && (
            <ul className="space-y-2">
              {proposals.map((p) => (
                <li key={p.key} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12.5px] font-semibold text-slate-100">{p.name}</span>
                    {p.kind === "narrow" && <span className="text-[8px] font-mono uppercase tracking-wider rounded px-1 py-0.5 border border-sky-500/40 text-sky-300" title="Built from words that keep appearing together in the broader seed's items">narrower</span>}
                    <span className="text-[9px] font-mono tabular-nums text-slate-500">{p.items} items · {p.sources} sources</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {p.phrases.map((ph) => {
                      const add = p.added.find((a) => a.term === ph);
                      return (
                        <span key={ph} className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${add ? "border-sky-500/40 text-sky-200" : "border-slate-700 text-slate-300"}`} title={add ? `found in your sources — ${add.why}` : "from your declaration"}>
                          {ph}
                        </span>
                      );
                    })}
                  </div>
                  <p className="text-[10.5px] text-slate-400 leading-snug">Why: {p.why}</p>
                  {p.droppedPhrases.length > 0 && <p className="text-[9.5px] text-slate-600">left out (named nothing in your sources): {p.droppedPhrases.join(" · ")}</p>}
                  {p.samples.length > 0 && (
                    <ul className="text-[10px] text-slate-500 space-y-0.5">
                      {p.samples.map((s) => (
                        <li key={s.id} className="truncate" title={s.title}>
                          e.g. <span className="text-slate-600">{s.source}</span> · {s.link ? <a href={s.link} target="_blank" rel="noreferrer" className="hover:text-slate-300">{s.title}</a> : s.title}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <button type="button" onClick={() => act(p, "track")} disabled={busy === p.key} className="text-[9.5px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-violet-500/50 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 disabled:opacity-40">{busy === p.key ? "…" : "Track"}</button>
                    <button type="button" onClick={() => onEdit(p)} disabled={busy === p.key} className="text-[9.5px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-400 hover:text-slate-200">Edit, then track</button>
                    <button type="button" onClick={() => act(p, "dismiss")} disabled={busy === p.key} className="text-[9.5px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-500 hover:text-red-300 hover:border-red-500/40" title="Never propose this again — shared with the crew, permanent">Never</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {body && body.skipped.length > 0 && (
            <div>
              <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} className="text-[9.5px] text-slate-600 hover:text-slate-400">
                {body.considered} declared things read · {body.skipped.length} not proposed — why {why ? "▴" : "▾"}
              </button>
              {why && (
                <ul className="mt-1 text-[9.5px] text-slate-600 space-y-0.5">
                  {body.skipped.slice(0, 30).map((s) => <li key={s.key}><span className="text-slate-500">{s.name}</span> — {s.reason}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
