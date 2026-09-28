"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_TTL, FEEDBACK_EVENT, type Feedback } from "@/lib/feedback";

// The one place feedback renders. Mounted once in RootLayout so it is on every
// page, including login. Bottom-CENTRE on purpose: the floating assistant owns
// bottom-right, the map's toolbar popovers drop from the top, and a toast must
// never cover either.
//
// aria-live="polite" so a screen reader announces it without interrupting;
// role="status" rather than "alert" for the same reason — an error toast here
// is a save that failed, not a fire.

interface Shown extends Feedback { id: number; at: number }

const TONE: Record<Feedback["tone"], string> = {
  ok: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200",
  info: "border-sky-500/50 bg-sky-500/10 text-sky-200",
  warn: "border-amber-500/50 bg-amber-500/10 text-amber-200",
  error: "border-red-500/55 bg-red-500/10 text-red-200",
};
const GLYPH: Record<Feedback["tone"], string> = { ok: "✓", info: "◇", warn: "⚠", error: "✕" };

const MAX_SHOWN = 3;

export default function ToastHost() {
  const [items, setItems] = useState<Shown[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const onToast = (e: Event) => {
      const f = (e as CustomEvent<Feedback>).detail;
      if (!f?.text) return;
      const id = ++seq.current;
      setItems((prev) => [...prev.slice(-(MAX_SHOWN - 1)), { ...f, id, at: Date.now() }]);
      const ttl = f.ttlMs ?? DEFAULT_TTL[f.tone] ?? 4000;
      window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), ttl);
    };
    window.addEventListener(FEEDBACK_EVENT, onToast);
    return () => window.removeEventListener(FEEDBACK_EVENT, onToast);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-1.5 px-4 pointer-events-none"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-md w-full sm:w-auto sm:min-w-[280px] rounded-lg border px-3 py-2 shadow-xl backdrop-blur bg-slate-950/90 text-[12px] leading-snug flex items-start gap-2 motion-safe:animate-[fadeUp_160ms_ease-out] ${TONE[t.tone]}`}
        >
          <span className="text-[12px] font-bold flex-shrink-0 mt-px" aria-hidden="true">{GLYPH[t.tone]}</span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold">{t.text}</span>
            {t.detail && <span className="block text-[11px] opacity-80 mt-0.5 break-words">{t.detail}</span>}
          </span>
          <button
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            aria-label="Dismiss notification"
            className="flex-shrink-0 opacity-60 hover:opacity-100 text-[13px] leading-none px-1"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
