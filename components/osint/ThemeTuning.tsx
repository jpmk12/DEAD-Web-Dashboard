"use client";

import { useCallback, useEffect, useState } from "react";
import { relTime } from "@/lib/relTime";
import { toast } from "@/lib/feedback";
import type { Theme, ThemeRead, ThemeSourceKind } from "@/lib/themes";
import type { PhraseStat, TuneSuggestions, ThemeVerdict } from "@/lib/themeTuning";

// The tuning half of an open theme row (lib/themeTuning, PURE, no model
// call): each phrase's hits and precision, suggested phrases with their
// evidence, items the theme probably misses, and ✓ / ✕ on its matches. Every
// suggestion states why; "never" is permanent; a ✕ offers exclusions, it
// never applies one. Nothing here changes a level.

interface TuneBody {
  theme: Theme;
  pool: { answered: boolean; note: string | null; items: number; days: number; byKind: Partial<Record<ThemeSourceKind, { items: number; oldest: string }>> };
  stats: PhraseStat[];
  suggest: TuneSuggestions | null;
  marks: Record<string, ThemeVerdict>;
  feedbackLive: boolean;
}

const MOD_CLS: Record<string, string> = { act: "text-red-300", threat: "text-amber-300", analysis: "text-slate-400", reversal: "text-emerald-300" };
const KIND_WORD: Record<ThemeSourceKind, string> = { x: "X", newsletter: "newsletters", analysis: "articles", feed: "feeds", wire: "wires" };
const btn = "text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border";

export async function postTune(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch("/api/osint/themes/tune", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r.ok || !j) throw new Error((j?.error as string) || `HTTP ${r.status}`);
  return j;
}

export default function ThemeTuning({ theme, read, onChanged }: { theme: Theme; read: ThemeRead | null; onChanged: () => void }) {
  const [tune, setTune] = useState<TuneBody | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [offers, setOffers] = useState<Record<string, string[]>>({});
  const [marks, setMarks] = useState<Record<string, ThemeVerdict>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/osint/themes/tune?id=${encodeURIComponent(theme.id)}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as TuneBody | null;
      if (!r.ok || !j) { setStatus("error"); return; }
      setTune(j);
      setMarks(j.marks ?? {});
      setStatus("ok");
    } catch { setStatus("error"); }
  }, [theme.id]);
  useEffect(() => { load(); }, [load]);

  const edit = async (op: string, phrase: string, okText: string) => {
    setBusy(`${op}:${phrase}`);
    try {
      const j = await postTune({ op, themeId: theme.id, phrase });
      toast.ok(okText, typeof j.backfill === "string" ? j.backfill : undefined);
      onChanged();
      await load();
    } catch (e) { toast.error("Could not change the theme", e); }
    finally { setBusy(null); }
  };

  const never = async (term: string) => {
    setBusy(`never:${term}`);
    try {
      await postTune({ op: "dismiss", themeId: theme.id, term });
      setTune((t) => t && t.suggest ? { ...t, suggest: { ...t.suggest, suggestions: t.suggest.suggestions.filter((s) => s.term !== term) } } : t);
    } catch (e) { toast.error("Could not save", e); }
    finally { setBusy(null); }
  };

  const mark = async (id: string, phrase: string, text: string, verdict: ThemeVerdict | null) => {
    const prev = marks[id];
    setMarks((m) => { const n = { ...m }; if (verdict) n[id] = verdict; else delete n[id]; return n; });
    try {
      const j = await postTune({ op: "feedback", themeId: theme.id, itemId: id, phrase, text, verdict });
      const ex = Array.isArray(j.exclusions) ? (j.exclusions as string[]) : [];
      setOffers((o) => ({ ...o, [id]: verdict === "no" ? ex : [] }));
    } catch (e) {
      setMarks((m) => { const n = { ...m }; if (prev) n[id] = prev; else delete n[id]; return n; });
      toast.error("Could not save the mark", e);
    }
  };

  const stats = tune?.stats ?? [];
  const sug = tune?.suggest ?? null;
  const exclude = tune?.theme.exclude ?? theme.exclude ?? [];
  const phraseCount = tune?.theme.phrases.length ?? theme.phrases.length;

  return (
    <div className="space-y-3">
      {status === "loading" && <div className="text-[10px] text-slate-600">reading your sources for tuning…</div>}
      {status === "error" && <div className="text-[10px] text-red-400">Could not read the tuning data.</div>}
      {tune && !tune.pool.answered && <div className="text-[10px] text-amber-300">Tuning needs your sources — {tune.pool.note}</div>}

      {tune && tune.pool.answered && (
        <>
          <div className="text-[9.5px] text-slate-600">
            read over {tune.pool.items} item{tune.pool.items === 1 ? "" : "s"} in {tune.pool.days} d ·{" "}
            {(Object.keys(tune.pool.byKind) as ThemeSourceKind[]).map((k) => `${KIND_WORD[k]} ${tune.pool.byKind[k]!.items} (from ${relTime(tune.pool.byKind[k]!.oldest)})`).join(" · ")}
          </div>

          <section>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Phrases</div>
            <ul className="space-y-0.5">
              {stats.map((s) => (
                <li key={s.phrase} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className={`font-mono text-[10.5px] px-1.5 py-0.5 rounded border ${s.flag ? "border-amber-500/40 text-amber-200" : "border-slate-700 text-slate-200"}`}>{s.phrase}</span>
                  <span className="font-mono tabular-nums text-[10px] text-slate-300">{s.hits}</span>
                  {s.flag && <span className="text-[8.5px] font-bold uppercase tracking-wider text-amber-300">{s.flag}</span>}
                  <span className="text-[10px] text-slate-500 min-w-0 flex-1">{s.why}{s.lastSeen ? ` · newest ${relTime(s.lastSeen)}` : ""}</span>
                  {phraseCount > 1 && (
                    <button type="button" disabled={!!busy} onClick={() => edit("remove-phrase", s.phrase, `Dropped “${s.phrase}”`)} className={`${btn} border-slate-700 text-slate-500 hover:text-red-300 disabled:opacity-40`} title="Drop this phrase from the theme">drop</button>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-[9.5px] text-slate-600 mt-1">Spelling variants match on their own: KC-46 = KC46, air base = airbase, refueling = refuelling.</p>
          </section>

          {exclude.length > 0 && (
            <section className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Not when</span>
              {exclude.map((x) => (
                <span key={x} className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400">
                  {x}
                  <button type="button" disabled={!!busy} onClick={() => edit("remove-exclude", x, `Removed exclusion “${x}”`)} aria-label={`Remove exclusion ${x}`} className="text-slate-600 hover:text-red-300">✕</button>
                </span>
              ))}
              <span className="basis-full text-[9.5px] text-slate-600">an occurrence of these is blanked out before the phrases are matched — the item still counts if a phrase appears elsewhere in it</span>
            </section>
          )}

          <section>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Suggested phrases <span className="font-normal normal-case tracking-normal text-slate-600">— common in this theme&apos;s items, rare in the rest of your sources</span></div>
            {!sug || sug.note ? (
              <div className="text-[10px] text-slate-600">{sug?.note ?? "—"}</div>
            ) : sug.suggestions.length === 0 ? (
              <div className="text-[10px] text-slate-600">No term clears the bar (in ≥3 matched items from ≥2 sources, ≥4× likelier here, adds items the theme misses).</div>
            ) : (
              <ul className="space-y-1">
                {sug.suggestions.map((s) => (
                  <li key={s.term} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded border border-violet-500/40 text-violet-200">{s.term}</span>
                    <span className="text-[10px] text-slate-500 min-w-0 flex-1">{s.why}</span>
                    <button type="button" disabled={!!busy || phraseCount >= 12} onClick={() => edit("add-phrase", s.term, `Added “${s.term}”`)} className={`${btn} border-violet-500/50 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 disabled:opacity-40`} title={phraseCount >= 12 ? "A theme holds 12 phrases — drop one first" : "Add as a phrase; the theme's history is rebuilt"}>＋ add</button>
                    <button type="button" disabled={!!busy} onClick={() => never(s.term)} className={`${btn} border-slate-700 text-slate-500 hover:text-slate-300 disabled:opacity-40`} title="Never suggest this term for this theme again">never</button>
                  </li>
                ))}
              </ul>
            )}
            {sug && sug.coTerms.length > 0 && (
              <div className="text-[9.5px] text-slate-600 mt-1" title="Terms far likelier in this theme's items than elsewhere — the vocabulary the misses are found by">
                also names: {sug.coTerms.slice(0, 10).map((c) => c.term).join(" · ")}
              </div>
            )}
          </section>

          {sug && sug.misses.length > 0 && (
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Probably missing <span className="font-normal normal-case tracking-normal text-slate-600">— items naming two or more of those terms and none of your phrases</span></div>
              <ul className="space-y-1">
                {sug.misses.map((m) => (
                  <li key={m.id} className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      {m.link ? <a href={m.link} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-violet-300">{m.title}</a> : <span className="text-slate-300">{m.title}</span>}
                      <span className="block text-[10px] text-slate-600">{m.source} · {relTime(m.pubDate)} · names {m.terms.join(", ")}</span>
                    </span>
                    <button type="button" disabled={!!busy || phraseCount >= 12} onClick={() => edit("add-phrase", m.suggest, `Added “${m.suggest}”`)} className={`${btn} flex-shrink-0 border-violet-500/50 text-violet-300 hover:bg-violet-500/10 disabled:opacity-40`} title={`Add “${m.suggest}” as a phrase`}>＋ {m.suggest}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {read && (
        <section>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Matches <span className="font-normal normal-case tracking-normal text-slate-600">— ✓ on theme · ✕ off theme (not counted; offers an exclusion)</span></div>
          {read.matches.length > 0 ? (
            <ul className="space-y-1">
              {read.matches.map((m) => {
                const v = marks[m.id];
                const offer = offers[m.id] ?? [];
                return (
                  <li key={m.id} className="flex items-start gap-2">
                    <span className={`text-[8px] font-mono uppercase tracking-wider border rounded px-1 py-0.5 flex-shrink-0 mt-0.5 border-slate-700 ${MOD_CLS[m.modality]}`}>{m.modality}</span>
                    <span className={`min-w-0 flex-1 ${v === "no" ? "opacity-50" : ""}`}>
                      {m.link ? <a href={m.link} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-violet-300">{m.title}</a> : <span className="text-slate-200">{m.title}</span>}
                      <span className="block text-[10px] text-slate-600">{m.source} · {relTime(m.pubDate)} · matched “{m.phrase}”</span>
                      {v === "no" && offer.length > 0 && (
                        <span className="flex flex-wrap items-center gap-1 mt-0.5">
                          <span className="text-[9.5px] text-slate-500">exclude</span>
                          {offer.map((x) => (
                            <button key={x} type="button" disabled={!!busy || exclude.some((e) => e.toLowerCase() === x.toLowerCase())} onClick={() => edit("add-exclude", x, `Excluding “${x}”`)} className={`${btn} border-slate-600 text-slate-300 hover:border-violet-500/50 disabled:opacity-40`}>“{x}”</button>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-0.5 flex-shrink-0">
                      <button type="button" aria-pressed={v === "yes"} onClick={() => mark(m.id, m.phrase, m.title, v === "yes" ? null : "yes")} title="On theme" className={`${btn} ${v === "yes" ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10" : "border-slate-700 text-slate-600 hover:text-emerald-300"}`}>✓</button>
                      <button type="button" aria-pressed={v === "no"} onClick={() => mark(m.id, m.phrase, m.title, v === "no" ? null : "no")} title="Off theme — not counted from the next read" className={`${btn} ${v === "no" ? "border-red-500/50 text-red-300 bg-red-500/10" : "border-slate-700 text-slate-600 hover:text-red-300"}`}>✕</button>
                    </span>
                  </li>
                );
              })}
              {read.reports > read.matches.length && <li className="text-[10px] text-slate-600">… {read.reports - read.matches.length} more counted, not listed</li>}
            </ul>
          ) : (
            <div className="text-slate-600 text-[10.5px]">{read.volume.state === "unobserved" ? "Your sources did not answer this pass — UNKNOWN, not quiet." : "No item in your sources names it in the window — absence of a post, not evidence of calm."}</div>
          )}
          {tune && !tune.feedbackLive && <div className="text-[9.5px] text-amber-300 mt-1">marks unavailable — the store did not answer</div>}
        </section>
      )}
    </div>
  );
}
