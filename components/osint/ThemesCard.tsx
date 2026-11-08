"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { relTime } from "@/lib/relTime";
import { toast } from "@/lib/feedback";
import { validateThemeDraft, parsePhrasesText, THEME_WINDOW_DAYS, THEME_LEARNING_DAYS, type Theme, type ThemeRead, type ThemeVolumeState } from "@/lib/themes";
import type { ThemesBody } from "@/lib/themesAssemble";
import type { PhrasePreview } from "@/lib/themeTuning";
import ThemeTuning, { postTune } from "./ThemeTuning";

// Declared themes — "what are my own sources saying about X". A theme is a
// name and a few phrases; the read (lib/themes, PURE) is volume against the
// theme's OWN normal, who is saying it, how it is framed, and whether the
// wires also name it. No sentiment score — counts and framing only. A theme
// never sets a level on its own surfaces; attached to an I&W board (✎ → boards)
// it is one more indicator there, capped at watching. Own sources only caps at
// watching and the row says so.

const VOL_CHIP: Record<ThemeVolumeState, string> = {
  surge: "text-amber-300 border-amber-500/45 bg-amber-500/10",
  normal: "text-slate-300 border-slate-600 bg-slate-800/40",
  quiet: "text-slate-500 border-slate-700",
  learning: "text-sky-300 border-sky-500/40 bg-sky-500/10",
  unobserved: "text-slate-300 border-slate-500 bg-slate-700/40",
};
const MOD_CLS: Record<string, string> = { act: "text-red-300", threat: "text-amber-300", analysis: "text-slate-400", reversal: "text-emerald-300" };
const VOL_WORD: Record<ThemeVolumeState, string> = { surge: "surge", normal: "normal", quiet: "quiet", learning: "learning", unobserved: "unknown" };

export default function ThemesCard({ active = true }: { active?: boolean }) {
  const [body, setBody] = useState<ThemesBody | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "pending" | "unavailable" | "ok" | "error">("idle");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Theme | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const tries = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (retry.current) clearTimeout(retry.current); }, []);

  const load = useCallback(async (refresh = false) => {
    setStatus((s) => (s === "ok" ? s : "loading"));
    try {
      const r = await fetch(`/api/osint/themes${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as ThemesBody | null;
      if (!j) { setStatus("error"); return; }
      if (r.status === 202 || j.pending) {
        if (j.reads?.length || j.themes) setBody(j);
        setStatus("pending");
        if (tries.current < 6) {
          tries.current++;
          if (retry.current) clearTimeout(retry.current);
          // Re-ask only while the pane is open and the window visible.
          retry.current = setTimeout(() => { if (activeRef.current && document.visibilityState === "visible") load(); }, 6_000);
        }
        return;
      }
      tries.current = 0;
      setBody(j);
      setStatus(r.status === 503 || j.themes === null ? "unavailable" : "ok");
    } catch { setStatus("error"); }
  }, []);

  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { if (active) load(); }, [active, load]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [active, load]);

  const remove = async (t: Theme) => {
    setBusy(t.id);
    try {
      const r = await fetch(`/api/osint/themes?id=${encodeURIComponent(t.id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      toast.ok(`Removed “${t.name}”`);
      load(true);
    } catch (e) { toast.error("Could not remove the theme", e); }
    finally { setBusy(null); }
  };

  const themes = body?.themes ?? [];
  const reads = body?.reads ?? [];
  const readById = new Map(reads.map((r) => [r.id, r]));
  // The reads' order (surge · corroborated · reports) leads; a theme declared
  // after the last read (no read yet) trails in declaration order.
  const ordered: Theme[] = [
    ...reads.map((r) => themes.find((t) => t.id === r.id)).filter((t): t is Theme => !!t),
    ...themes.filter((t) => !readById.has(t.id)),
  ];

  return (
    <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden mb-4" data-testid="themes-card">
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
        <span className="text-[11px] font-bold uppercase tracking-widest text-violet-300">◈ Your themes</span>
        <span className="text-[10px] text-slate-600">what your own sources are saying · {THEME_WINDOW_DAYS} d · no sentiment score</span>
        {status === "unavailable" && <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border text-amber-300 border-amber-500/40 bg-amber-500/10" title="The theme store did not answer — themes you declared may exist and cannot be shown.">unavailable</span>}
        {status === "pending" && <span className="text-[9px] font-mono uppercase text-slate-500">reading your sources…</span>}
        {body?.pool && status === "ok" && themes.length > 0 && (
          <span className="text-[9px] font-mono text-slate-600" title="Own-source items read · wire feeds that answered">
            {body.pool.ownAnswered ? `${body.pool.own} own items` : "own sources did not answer"} · wires {body.pool.wireFeeds}/{body.pool.wireFeedsTotal}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => load(true)} className="text-[9.5px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-500 hover:text-slate-300" title="Re-read now">↻</button>
          <button type="button" onClick={() => { setEditing(null); setAdding((v) => !v); }} aria-expanded={adding} className="text-[9.5px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-violet-500/50 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20">＋ Theme {adding ? "▴" : "▾"}</button>
        </span>
      </div>

      {(adding || editing) && (
        <ThemeForm
          initial={editing}
          onDone={() => { setAdding(false); setEditing(null); load(true); }}
          onCancel={() => { setAdding(false); setEditing(null); }}
        />
      )}

      {status === "error" && <p className="px-3.5 py-2 text-[11px] text-red-400 border-b border-slate-800">Could not read the themes.</p>}

      {/* The invitation only when the store ANSWERED with none — a pending or
          failed read is not "nothing declared" (code review 2026-10-28). */}
      {themes.length === 0 && status === "ok" && !adding && (
        <p className="px-3.5 py-3 text-[11px] text-slate-500 leading-relaxed">
          Declare a theme — a name and a few phrases (“tanker surge”, “KC-135 wave”, “refueling bridge”) — and this card reads your X captures,
          newsletters, captured articles and OSINT feeds for it: how much against the theme&apos;s own normal, who is saying it, how it is framed
          (act · threat · analysis · reversal), and whether the wires agree. A theme never sets a level.
        </p>
      )}

      {themes.length > 0 && (
        <ul className="divide-y divide-slate-800/60">
          {ordered.map((t) => {
            const read = readById.get(t.id) ?? null;
            const isOpen = open === t.id;
            return (
              <li key={t.id} id={`theme-${t.id}`}>
                <div className="flex items-start gap-2.5 px-3.5 py-2">
                  <button type="button" onClick={() => setOpen(isOpen ? null : t.id)} aria-expanded={isOpen} className="flex-1 min-w-0 text-left group">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12.5px] font-semibold text-slate-100 group-hover:text-violet-300 transition-colors">{t.name}</span>
                      {read ? (
                        <span className={`text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border ${VOL_CHIP[read.volume.state]}`} title={read.volume.why}>{VOL_WORD[read.volume.state]}</span>
                      ) : (
                        <span className="text-[9px] font-mono uppercase text-slate-600">{status === "pending" || status === "loading" ? "reading…" : "no read"}</span>
                      )}
                      {read && read.reports > 0 && (
                        <span className={`text-[8px] font-mono uppercase tracking-wider rounded px-1 py-0.5 border ${read.corroborated ? "text-amber-300 border-amber-500/40" : "text-slate-500 border-slate-700"}`}>{read.corroborated ? `${read.handles} sources` : "single source"}</span>
                      )}
                      {(t.boards?.length ?? 0) > 0 && <span className="text-[8px] font-mono uppercase tracking-wider text-violet-300/80" title="Attached to I&W boards as a watching-capped indicator — edit with ✎">on {t.boards!.length} board{t.boards!.length === 1 ? "" : "s"}</span>}
                      {read && read.ownOnly && read.reports > 0 && <span className="text-[8px] font-mono uppercase tracking-wider text-slate-600" title="No wire item names it — a theme read from your own sources alone reads as watching at most and never sets a level.">own sources only · caps at watching</span>}
                      {read && read.wires != null && read.wires > 0 && <span className="text-[8px] font-mono uppercase tracking-wider text-emerald-400/80">{read.wires} wire item{read.wires === 1 ? "" : "s"} agree</span>}
                      <span className="text-[9px] font-mono uppercase text-slate-600">{isOpen ? "▴" : "▾"}</span>
                    </span>
                    <span className="block text-[10.5px] text-slate-500 truncate" title={read?.line ?? t.phrases.join(" · ")}>
                      {read ? (
                        <>
                          {read.reports ? `${read.reports} item${read.reports === 1 ? "" : "s"} · ` : `nothing in ${THEME_WINDOW_DAYS} d · `}
                          {(["act", "threat", "analysis", "reversal"] as const).filter((k) => read.framing[k]).map((k) => <span key={k} className={`${MOD_CLS[k]} mr-1.5`}>{read.framing[k]} {k}</span>)}
                          {read.volume.state === "learning" || read.volume.state === "surge" ? <span className="text-slate-600">· {read.volume.why}</span> : null}
                        </>
                      ) : t.phrases.join(" · ")}
                    </span>
                    {read?.lead && (
                      <span className="block text-[10.5px] text-slate-400 truncate" title={read.lead.title}>
                        newest · <span className="text-slate-500">{read.lead.source}</span> · {read.lead.title}
                      </span>
                    )}
                  </button>
                  <span className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                    <button type="button" onClick={() => { setAdding(false); setEditing(t); }} className="text-[9.5px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border border-slate-700 text-slate-500 hover:text-slate-300" title="Edit the phrases">✎</button>
                    <button type="button" onClick={() => remove(t)} disabled={busy === t.id} aria-label={`Remove ${t.name}`} className="text-[11px] rounded px-1.5 py-0.5 border border-slate-700 text-slate-500 hover:text-red-300 hover:border-red-500/40 disabled:opacity-40" title="Remove this theme">✕</button>
                  </span>
                </div>
                {isOpen && (
                  <div className="px-3.5 pb-3 space-y-2 text-[11px]">
                    <div className="text-slate-500">
                      <span className="text-slate-600">declared by {t.by.split("@")[0] || "crew"} {t.updatedAt ? relTime(t.updatedAt) : ""}</span>
                    </div>
                    {read && (
                      <>
                        <div className="text-slate-400">{read.line}</div>
                        <DayStrip byDay={read.byDay} />
                      </>
                    )}
                    <ThemeTuning theme={t} read={read} onChanged={() => load(true)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
        Phrases, word-bounded; framing is the same act / threat / analysis / reversal grammar the straits use — never a mood score. Volume is judged against
        each theme&apos;s own trailing normal after {THEME_LEARNING_DAYS} observed days. Shared with the crew. A theme never changes a level anywhere.
      </p>
    </div>
  );
}

function DayStrip({ byDay }: { byDay: Record<string, number> }) {
  const days: string[] = [];
  for (let i = THEME_WINDOW_DAYS - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  const max = Math.max(1, ...days.map((d) => byDay[d] ?? 0));
  return (
    <div className="flex items-end gap-0.5 h-5" title="Items per UTC day, last 7 days (newest right)">
      {days.map((d) => {
        const n = byDay[d] ?? 0;
        return <span key={d} className={`w-3 rounded-sm ${n ? "bg-violet-400/70" : "bg-slate-800"}`} style={{ height: `${Math.max(2, Math.round((n / max) * 18))}px` }} title={`${d}: ${n}`} />;
      })}
    </div>
  );
}

function ThemeForm({ initial, onDone, onCancel }: { initial: Theme | null; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [text, setText] = useState(initial?.phrases.join(", ") ?? "");
  const [exText, setExText] = useState(initial?.exclude?.join(", ") ?? "");
  // What the phrase set WOULD catch in the stored pool, before saving.
  const [preview, setPreview] = useState<{ p: PhrasePreview | null; note: string | null; loading: boolean }>({ p: null, note: null, loading: false });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // I&W boards the theme rides on as a watching-capped indicator (2026-11-04).
  const [boards, setBoards] = useState<string[]>(initial?.boards ?? []);
  const [boardList, setBoardList] = useState<{ problemId: string; label: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/warning").then((r) => (r.ok ? r.json() : null)).then((j: { problems?: { problemId: string; label: string }[] } | null) => {
      if (alive) setBoardList((j?.problems ?? []).map((p) => ({ problemId: p.problemId, label: p.label })));
    }).catch(() => { if (alive) setBoardList([]); });
    return () => { alive = false; };
  }, []);
  const phrases = parsePhrasesText(text);
  const exclude = parsePhrasesText(exText);
  const problem = validateThemeDraft({ name, phrases });
  const pKey = JSON.stringify([phrases, exclude]);
  useEffect(() => {
    const [ph, ex] = JSON.parse(pKey) as [string[], string[]];
    if (!ph.length) { setPreview({ p: null, note: null, loading: false }); return; }
    let alive = true;
    setPreview((v) => ({ ...v, loading: true }));
    const id = setTimeout(() => {
      postTune({ op: "preview", phrases: ph, exclude: ex })
        .then((j) => { if (alive) setPreview({ p: (j.preview as PhrasePreview) ?? null, note: j.answered === false ? String(j.note ?? "") : null, loading: false }); })
        .catch(() => { if (alive) setPreview({ p: null, note: "preview unavailable", loading: false }); });
    }, 600);
    return () => { alive = false; clearTimeout(id); };
  }, [pKey]);

  const save = async () => {
    if (problem) { setErr(problem); return; }
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/osint/themes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: initial?.id, name, phrases, exclude, boards }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      toast.ok(initial ? `Updated “${name.trim()}”` : `Declared “${name.trim()}”`, typeof j?.backfill === "string" ? j.backfill : undefined);
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setErr(msg);
      toast.error("Could not save the theme", e);
    } finally { setSaving(false); }
  };

  return (
    <div className="px-3.5 py-3 border-b border-slate-800 bg-slate-900/60 space-y-2">
      <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
        <label className="block">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tanker surge" maxLength={40} className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[12px] text-slate-100 focus:border-violet-500/60 outline-none" />
        </label>
        <label className="block">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Phrases — comma or newline separated, up to 12</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="tanker surge, KC-135 wave, refueling bridge" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[12px] text-slate-100 focus:border-violet-500/60 outline-none font-mono" />
        </label>
      </div>
      <label className="block">
        <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Not when — exclusion phrases (optional)</span>
        <input value={exText} onChange={(e) => setExText(e.target.value)} placeholder="oil tanker, tanker truck" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[12px] text-slate-100 focus:border-violet-500/60 outline-none font-mono" />
      </label>
      <PreviewLine preview={preview} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mr-1">On I&amp;W boards</span>
        {boardList == null ? <span className="text-[10px] text-slate-600">loading boards…</span>
          : boardList.length === 0 ? <span className="text-[10px] text-slate-600">no boards answered — attach later</span>
          : boardList.map((b) => {
            const on = boards.includes(b.problemId);
            return (
              <button key={b.problemId} type="button" aria-pressed={on} onClick={() => setBoards((v) => on ? v.filter((x) => x !== b.problemId) : [...v, b.problemId])}
                className={`text-[10px] rounded border px-1.5 py-0.5 ${on ? "border-violet-500/60 bg-violet-500/10 text-violet-200" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}>
                {on ? "✓ " : ""}{b.label}
              </button>
            );
          })}
        <span className="basis-full text-[9.5px] text-slate-600">an attached theme is one more indicator on that board — your own sources only, so it can lift a calm board to watch and never higher; silent until the theme has {THEME_LEARNING_DAYS} days of normal</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-slate-600 flex-1 min-w-0">{phrases.length ? `${phrases.length} phrase${phrases.length === 1 ? "" : "s"}: ${phrases.join(" · ")}` : "phrases are matched word-bounded, case-insensitive, in your own sources only"}</span>
        <button type="button" onClick={onCancel} className="text-[9.5px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-500 hover:text-slate-300">Cancel</button>
        <button type="button" onClick={save} disabled={saving || !!problem} title={problem ?? undefined} className="text-[9.5px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-violet-500/50 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 disabled:opacity-40">{saving ? "…" : initial ? "Save" : "Declare"}</button>
      </div>
      {(err || (problem && (name || text))) && <p className="text-[10.5px] text-amber-300">{err ?? problem}</p>}
    </div>
  );
}

function PreviewLine({ preview }: { preview: { p: PhrasePreview | null; note: string | null; loading: boolean } }) {
  const { p, note, loading } = preview;
  if (note) return <p className="text-[10px] text-amber-300">Preview: {note}</p>;
  if (!p) return loading ? <p className="text-[10px] text-slate-600">checking your sources…</p> : null;
  const kinds = Object.entries(p.byKind).map(([k, n]) => `${k} ${n}`).join(" · ");
  return (
    <div className={`text-[10.5px] space-y-0.5 ${loading ? "opacity-60" : ""}`}>
      <div className="text-slate-300">
        Preview — these phrases match <span className="font-mono tabular-nums">{p.total}</span> item{p.total === 1 ? "" : "s"} from {p.sources} source{p.sources === 1 ? "" : "s"} already in your stored sources (last {p.days} d){kinds ? ` (${kinds})` : ""}
        {p.excluded > 0 && <span className="text-slate-500"> · {p.excluded} kept out by exclusions</span>}
        <span className="block text-[9.5px] text-slate-600">matched now; the theme counts them once you save (the card&apos;s count covers the last 7 d)</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {p.byPhrase.map((b) => (
          <span key={b.phrase} className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${b.hits ? "border-slate-700 text-slate-300" : "border-amber-500/40 text-amber-300"}`} title={b.hits ? undefined : "No item in your stored sources names this — check the spelling, or it is a term your sources do not use"}>{b.phrase} {b.hits}</span>
        ))}
      </div>
      {p.samples.length > 0 && (
        <ul className="text-[10px] text-slate-500 space-y-0.5">
          {p.samples.slice(0, 3).map((s) => <li key={s.id} className="truncate" title={s.title}>“{s.phrase}” · {s.source} · {s.title}</li>)}
        </ul>
      )}
      {p.total === 0 && <p className="text-[10px] text-slate-600">Nothing in your stored sources — the theme will read quiet until a source uses one of these phrases.</p>}
    </div>
  );
}
