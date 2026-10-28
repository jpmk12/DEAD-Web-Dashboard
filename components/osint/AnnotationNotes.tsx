"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ANNOTATION_MAX_LEN, BOARD_KEY, isOpenAnnotation, latestOpenByTarget, recentlyResolved, sortAnnotations,
  validateAnnotationDraft, type Annotation,
} from "@/lib/annotations";
import { relTime } from "@/lib/relTime";
import { toast } from "@/lib/feedback";

// Analyst annotations on an I&W board — the crew's own voice beside the
// evidence (lib/annotations.ts). Violet throughout: the app's "yours" accent,
// never the earned amber / red of a level. A note changes nothing on the
// board; it is read by whoever opens it next and by "Ask the board".

export interface AnnotationsApi {
  entries: Annotation[];
  latest: Map<string, Annotation>;
  add: (indicatorId: string | null, note: string) => Promise<boolean>;
  resolve: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  error: string | null;
  busy: boolean;
  /** The store did not answer — UNAVAILABLE, never "no notes". */
  unavailable: boolean;
}

export function useAnnotations(problemId: string): AnnotationsApi {
  const [entries, setEntries] = useState<Annotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/warning/annotation?problemId=${encodeURIComponent(problemId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.entries)) { setEntries(d.entries); setUnavailable(false); }
        else setUnavailable(true);
      })
      .catch(() => setUnavailable(true));
  }, [problemId]);
  useEffect(() => { load(); }, [load]);

  const call = async (method: string, body?: unknown, qs = ""): Promise<boolean> => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/warning/annotation${qs}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      load();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg); toast.error("Note not saved", msg);
      return false;
    } finally { setBusy(false); }
  };

  return {
    entries,
    latest: latestOpenByTarget(entries),
    add: (indicatorId, note) => {
      const v = validateAnnotationDraft({ problemId, indicatorId, note });
      if (v) { setError(v); return Promise.resolve(false); }
      return call("POST", { problemId, indicatorId, note: note.trim() });
    },
    resolve: (id) => call("PATCH", { id }),
    remove: (id) => call("DELETE", undefined, `?id=${encodeURIComponent(id)}`),
    error, busy, unavailable,
  };
}

const who = (a: Annotation) => a.by.split("@")[0] || "crew";

/** One open note, as a line: author · age · resolve. Used on indicator rows
 *  and the board block alike. */
export function NoteLine({ a, api, dense }: { a: Annotation; api: AnnotationsApi; dense?: boolean }) {
  return (
    <div className={`flex items-start gap-2 ${dense ? "text-[10.5px]" : "text-[11px]"} text-violet-200/90 leading-snug`}>
      <span className="text-violet-400 flex-shrink-0">✎</span>
      <span className="flex-1 min-w-0 break-words">{a.note}</span>
      <span className="text-[9px] font-mono text-slate-500 flex-shrink-0 whitespace-nowrap" title={a.createdAt}>{who(a)} · {relTime(a.createdAt)}</span>
      <button onClick={() => api.resolve(a.id)} disabled={api.busy} title="Resolve this note (one-way)" className="text-[9px] uppercase tracking-wider text-slate-500 hover:text-emerald-300 flex-shrink-0 disabled:opacity-40">resolve</button>
    </div>
  );
}

/** The add box: a textarea and a save button. */
export function NoteAdd({ onSave, onCancel, busy, placeholder }: { onSave: (text: string) => Promise<boolean>; onCancel: () => void; busy: boolean; placeholder: string }) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-1.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, ANNOTATION_MAX_LEN))}
        rows={2}
        autoFocus
        placeholder={placeholder}
        className="w-full bg-slate-950 border border-violet-500/40 rounded px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600"
      />
      <div className="flex items-center gap-1.5">
        <button onClick={async () => { if (await onSave(text)) { setText(""); onCancel(); } }} disabled={busy || text.trim().length < 4}
          className="text-[9px] font-bold uppercase tracking-wider rounded px-2.5 py-1 border border-violet-500/50 bg-violet-500/10 text-violet-200 disabled:opacity-40">
          {busy ? "…" : "Save note"}
        </button>
        <button onClick={onCancel} className="text-[9px] uppercase tracking-wider text-slate-600 hover:text-slate-400">cancel</button>
        <span className="ml-auto text-[9px] text-slate-600">shared with the crew · never changes a level</span>
      </div>
    </div>
  );
}

/** The board-level block: whole-board notes, the per-indicator ones folded
 *  beneath with their labels, recently resolved last. */
export function BoardNotes({ api, indicatorLabel }: { api: AnnotationsApi; indicatorLabel: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const openNotes = sortAnnotations(api.entries).filter(isOpenAnnotation);
  const boardNotes = openNotes.filter((a) => (a.indicatorId ?? BOARD_KEY) === BOARD_KEY);
  const indicatorNotes = openNotes.filter((a) => (a.indicatorId ?? BOARD_KEY) !== BOARD_KEY);
  const resolved = recentlyResolved(api.entries);
  return (
    <div className="border-t border-slate-800 pt-2 mt-1">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
        <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-600">Analyst notes</span>
        {openNotes.length > 0 && (
          <span className="text-[8px] font-bold uppercase tracking-wider px-1 rounded border text-violet-300 border-violet-500/45 bg-violet-500/10">{openNotes.length} open</span>
        )}
        {api.unavailable && (
          <span className="text-[8px] font-bold uppercase tracking-wider px-1 rounded border text-amber-300 border-amber-500/45 bg-amber-500/10" title="The notes store did not answer — there may be notes you cannot see">unavailable</span>
        )}
        <span className="ml-auto text-[10px] text-slate-600">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {api.error && <p className="text-[10px] text-red-400">{api.error}</p>}
          {api.unavailable && (
            <p className="text-[10px] text-amber-300/90 leading-snug">Notes UNAVAILABLE — the store did not answer. There may be notes you cannot see; this is not “nothing noted”.</p>
          )}
          {openNotes.length === 0 && !adding && !api.unavailable && (
            <p className="text-[10px] text-slate-600 leading-snug">Nothing noted. A note is what you know that the sensors cannot — a known outage, an exercise, a thing to watch. It is shared with the crew, read by “Ask the board”, and never changes a level.</p>
          )}
          {boardNotes.map((a) => <NoteLine key={a.id} a={a} api={api} />)}
          {indicatorNotes.map((a) => (
            <div key={a.id}>
              <span className="text-[8.5px] font-mono uppercase tracking-wider text-slate-500">{indicatorLabel(a.indicatorId!)}</span>
              <NoteLine a={a} api={api} dense />
            </div>
          ))}
          {resolved.length > 0 && (
            <details className="text-[10px] text-slate-500">
              <summary className="cursor-pointer">{resolved.length} resolved in the last 14 days</summary>
              {resolved.map((a) => (
                <p key={a.id} className="mt-1 pl-3 leading-snug"><span className="text-slate-600">{a.indicatorId ? indicatorLabel(a.indicatorId) : "board"} · resolved {relTime(a.resolvedAt!)}</span> — {a.note}</p>
              ))}
            </details>
          )}
          {adding ? (
            <NoteAdd onSave={(t) => api.add(null, t)} onCancel={() => setAdding(false)} busy={api.busy} placeholder="A note on the whole board — what you know that the sensors cannot" />
          ) : (
            <button onClick={() => setAdding(true)} className="text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-400 hover:text-violet-200 hover:border-violet-500/40">✎ Add a board note</button>
          )}
        </div>
      )}
    </div>
  );
}
