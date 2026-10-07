"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SPECTRUM, type SpectrumDependencies } from "@/lib/missionProfile";
import { toast } from "@/lib/feedback";

// The spectrum declaration, edited WHERE IT IS READ (REVIEW-2026-10 §12
// item 7). The Mission Profile editor (components/preferences/
// MissionProfileEditor.tsx `SpectrumEditor`) stays the full form; these two
// widgets are the same fields with the same semantics, placed next to the
// surfaces whose "UNKNOWN" / "not declared" they explain:
//   · `EdgeVendorsInline`  — the SITREP Spectrum card's KEV row ("no vendors
//                            declared — UNKNOWN")
//   · `PolarRoutesInline`  — the Weather tab's radiation / S-scale row ("not
//                            declared, not a factor")
// Each change is one `PATCH /api/mission-profile { spectrum: partial }`
// (owner-gated; `patchSpectrum` merges the partial through
// `sanitizeSpectrum`), optimistic, with a toast and a revert on failure.
// Team config, never a prompt: nothing here reaches a model.

/** The ★ toast's wording (CommandBoard) — crew see the declaration, read-only. */
export const TEAM_CONFIG_TITLE = "Team config — the owner sets this";

interface Declaration { spectrum: SpectrumDependencies; canEdit: boolean }

// ONE `GET /api/mission-profile` per page (the Economy actor editor derives
// `canEdit` from the same GET); every widget on the page shares it, and a
// successful PATCH replaces it. `spectrum:changed` keeps sibling widgets in
// step without a second GET.
const TTL_MS = 10 * 60 * 1000;
const CHANGED_EVENT = "spectrum:changed";
let cached: { at: number; decl: Declaration } | null = null;
let inflight: Promise<Declaration | null> | null = null;

async function fetchDeclaration(): Promise<Declaration | null> {
  try {
    const r = await fetch("/api/mission-profile");
    if (!r.ok) return null;
    const d = await r.json();
    const spectrum: SpectrumDependencies = d?.profile?.spectrum ?? { ...DEFAULT_SPECTRUM };
    return { spectrum, canEdit: d?.canEdit === true };
  } catch {
    return null;
  }
}

function loadDeclaration(): Promise<Declaration | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.decl);
  if (!inflight) {
    inflight = fetchDeclaration()
      .then((decl) => { if (decl) cached = { at: Date.now(), decl }; return decl; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

function publish(decl: Declaration): void {
  cached = { at: Date.now(), decl };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<Declaration>(CHANGED_EVENT, { detail: decl }));
}

/**
 * The current declaration + `canEdit`, and `patch(partial)` — optimistic,
 * toasts, reverts on failure, resolves to the SAVED block (null on failure).
 * `onChanged` fires after a successful save so the host surface can re-fetch
 * what it reads (the SITREP payload, the space-weather route).
 */
export function useSpectrumDeclaration(onChanged?: () => void) {
  const [decl, setDecl] = useState<Declaration | null>(() => cached?.decl ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadDeclaration().then((d) => { if (alive && d) setDecl(d); });
    const onEvent = (e: Event) => { const d = (e as CustomEvent<Declaration>).detail; if (d) setDecl(d); };
    window.addEventListener(CHANGED_EVENT, onEvent);
    return () => { alive = false; window.removeEventListener(CHANGED_EVENT, onEvent); };
  }, []);

  const patch = useCallback(async (partial: Partial<SpectrumDependencies>, okText: string): Promise<SpectrumDependencies | null> => {
    const before = decl ?? { spectrum: { ...DEFAULT_SPECTRUM }, canEdit: false };
    if (!before.canEdit) { toast.info(TEAM_CONFIG_TITLE); return null; }
    const optimistic: Declaration = { ...before, spectrum: { ...before.spectrum, ...partial } };
    setDecl(optimistic);
    setBusy(true);
    try {
      const r = await fetch("/api/mission-profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spectrum: partial }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.spectrum) throw new Error(d?.error ?? `HTTP ${r.status}`);
      const saved: Declaration = { canEdit: before.canEdit, spectrum: d.spectrum as SpectrumDependencies };
      setDecl(saved);
      publish(saved);
      toast.ok(okText);
      onChanged?.();
      return saved.spectrum;
    } catch (err) {
      setDecl(before);
      toast.error("Could not save the spectrum declaration", err);
      return null;
    } finally {
      setBusy(false);
    }
  }, [decl, onChanged]);

  return { spectrum: decl?.spectrum ?? null, canEdit: decl?.canEdit ?? false, loaded: decl !== null, busy, patch };
}

const MAX_VENDORS = 24; // the editor's cap (sanitizeSpectrum enforces the same)

/**
 * Declared edge vendors as chips (✕ removes), an add box, and the one line
 * that says what they do. Mount it beside the KEV row that reads UNKNOWN.
 */
export function EdgeVendorsInline({ onChanged, initial }: {
  onChanged?: () => void;
  /** The vendors the host already holds (e.g. the SITREP payload), rendered
   *  until the GET lands so the chips never flash empty. */
  initial?: string[];
}) {
  const { spectrum, canEdit, loaded, busy, patch } = useSpectrumDeclaration(onChanged);
  const [vendor, setVendor] = useState("");
  const vendors = spectrum?.edgeVendors ?? initial ?? [];
  const disabled = !canEdit || busy || !loaded;

  const add = () => {
    const v = vendor.trim().slice(0, 40);
    if (v.length < 2) { setVendor(""); return; }
    if (vendors.some((x) => x.toLowerCase() === v.toLowerCase())) { setVendor(""); toast.info(`${v} is already declared`); return; }
    if (vendors.length >= MAX_VENDORS) { toast.warn(`Vendor list is full (${MAX_VENDORS}) — remove one first`); return; }
    setVendor("");
    void patch({ edgeVendors: [...vendors, v] }, `Declared ${v} — KEV is read against it now`);
  };
  const remove = (v: string) => {
    void patch({ edgeVendors: vendors.filter((x) => x !== v) }, `Removed ${v} from the KEV watch`);
  };

  return (
    <div className="mt-1 space-y-1" title={canEdit ? undefined : TEAM_CONFIG_TITLE}>
      <div className="flex flex-wrap items-center gap-1">
        {vendors.map((v) => (
          <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 inline-flex items-center gap-1">
            {v}
            <button type="button" disabled={disabled} onClick={() => remove(v)} title={canEdit ? `Remove ${v}` : TEAM_CONFIG_TITLE}
              aria-label={`Remove ${v}`} className="text-slate-600 hover:text-red-400 disabled:opacity-40 disabled:hover:text-slate-600">✕</button>
          </span>
        ))}
        {vendors.length === 0 && <span className="text-[10px] text-slate-600">none declared</span>}
      </div>
      <div className="flex items-center gap-1">
        <input value={vendor} disabled={disabled} onChange={(e) => setVendor(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={canEdit ? "Cisco, Fortinet, Palo Alto, Ivanti…" : "owner-set"}
          title={canEdit ? "Vendor or product name; Enter to add" : TEAM_CONFIG_TITLE}
          className="flex-1 min-w-0 max-w-[260px] bg-slate-950 border border-slate-800 focus:border-emerald-500/40 rounded px-1.5 py-0.5 text-[10.5px] text-slate-200 placeholder-slate-700 outline-none disabled:opacity-50" />
        <button type="button" onClick={add} disabled={disabled || vendor.trim().length < 2} title={canEdit ? "Add to the declared vendors" : TEAM_CONFIG_TITLE}
          className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded px-1.5 py-0.5 disabled:opacity-30">
          {busy ? "…" : "Add"}
        </button>
      </div>
      <p className="text-[9.5px] text-slate-600">
        The KEV feed is read against these — CISA Known Exploited Vulnerabilities × your declared vendors, never the NVD firehose. Devices on the wing&apos;s networks and at host airports.
        {loaded && !canEdit && <span className="text-slate-500"> {TEAM_CONFIG_TITLE}.</span>}
      </p>
    </div>
  );
}

/**
 * The polar / HF-route declaration as a two-state toggle. Mount it beside
 * the radiation / S-scale row that reads "not declared, not a factor".
 * `null` (never declared) lights neither side and says so.
 */
export function PolarRoutesInline({ onChanged, initial }: {
  onChanged?: () => void;
  /** The value the host already holds (the route's `polar`), until the GET lands. */
  initial?: boolean | null;
}) {
  const { spectrum, canEdit, loaded, busy, patch } = useSpectrumDeclaration(onChanged);
  const value: boolean | null = spectrum ? spectrum.polarRoutes : (initial ?? null);
  const disabled = !canEdit || busy || !loaded;
  const seg = (on: boolean, label: string, next: boolean, okText: string) => (
    <button type="button" disabled={disabled || on} onClick={() => { void patch({ polarRoutes: next }, okText); }}
      aria-pressed={on} title={canEdit ? (on ? "current declaration" : `Declare: ${label}`) : TEAM_CONFIG_TITLE}
      className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded border transition-colors disabled:cursor-default ${on
        ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10"
        : "border-slate-700 text-slate-500 hover:text-slate-300 disabled:opacity-50 disabled:hover:text-slate-500"}`}>
      {label}
    </button>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle" title={canEdit ? undefined : TEAM_CONFIG_TITLE}>
      {seg(value === true, "we fly polar", true, "Declared polar / HF routes — the S-scale rows now count")}
      {seg(value === false, "we don't fly polar", false, "Declared no polar / HF routes — S-scale reads \"not a factor\"")}
      {value === null && <span className="text-[9.5px] text-slate-600">not declared</span>}
      {loaded && !canEdit && <span className="text-[9px] text-slate-600">· owner-set</span>}
    </span>
  );
}
