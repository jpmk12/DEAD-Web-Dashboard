"use client";

import { useEffect, useMemo, useState } from "react";
import {
  deriveTracking, suggestChokepoints, suggestAoiCountries, slugify, EMPTY_PROFILE, SITREP_MAX, DEFAULT_SPECTRUM, EMPTY_MUST_TRACK,
  toggleMustTrack, isStarCountry,
  type MissionProfile, type MissionAoi, type MissionSpoke,
} from "@/lib/missionProfile";
import { CHOKEPOINTS } from "@/lib/chokepoints";
import type { Aor } from "@/lib/aor";

// Mission Profile editor — declare home station, theaters, and named AOIs;
// preview the derived tracking (client-side, lib/missionProfile is pure);
// exclude anything unwanted; then APPLY to materialize into the existing
// tracking lists. Owner-only writes (crew see a read-only declaration).

const AORS: Aor[] = ["CENTCOM", "EUCOM", "AFRICOM", "INDOPACOM", "SOUTHCOM", "NORTHCOM"];

// Spectrum dependencies (docs/REVIEW-CYBER-SPACE.md §6): three declarations
// the cyber/space surfaces need — polar/HF routes (S-scale relevance),
// SATCOM in use (card text), the edge-vendor watchlist (KEV × vendors) —
// plus whether the space-power boards carry `space_activity`. Team config;
// none of it enters a prompt (missionSummaryLine omits it).
function SpectrumEditor({ profile, canEdit, patch }: { profile: MissionProfile; canEdit: boolean; patch: (p: Partial<MissionProfile>) => void }) {
  const spec = profile.spectrum ?? DEFAULT_SPECTRUM;
  const [vendor, setVendor] = useState("");
  const set = (p: Partial<typeof spec>) => patch({ spectrum: { ...spec, ...p } });
  const addVendor = () => {
    const v = vendor.trim();
    if (v.length < 2 || spec.edgeVendors.some((x) => x.toLowerCase() === v.toLowerCase())) { setVendor(""); return; }
    set({ edgeVendors: [...spec.edgeVendors, v].slice(0, 24) });
    setVendor("");
  };
  const seg = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" disabled={!canEdit} onClick={onClick}
      className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${on ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}>
      {label}
    </button>
  );
  return (
    <div className="border border-slate-800 rounded-lg p-3 space-y-2.5 bg-slate-950/40">
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">Spectrum dependencies</label>
        <p className="text-[10px] text-slate-600 mt-0.5">What the force depends on in the electromagnetic and space domains. Drives the SITREP Spectrum card, the Weather tab&apos;s space-weather rows and the KEV exposure signal. Team config — never sent to a model.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] text-slate-400 w-36">Polar / HF-dependent routes</span>
        {seg(spec.polarRoutes === false, "No", () => set({ polarRoutes: false }))}
        {seg(spec.polarRoutes === true, "Yes", () => set({ polarRoutes: true }))}
        {seg(spec.polarRoutes === null, "Not declared", () => set({ polarRoutes: null }))}
        <span className="text-[9.5px] text-slate-600">— S-scale (radiation, polar-cap absorption) rows read &quot;not a factor&quot; when No.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] text-slate-400 w-36">SATCOM in use</span>
        <input value={spec.satcom} disabled={!canEdit} onChange={(e) => set({ satcom: e.target.value.slice(0, 120) })} placeholder="e.g. WGS Ku · Inmarsat L-band"
          className="flex-1 min-w-[180px] bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 disabled:opacity-50" />
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <span className="text-[10.5px] text-slate-400 w-36 pt-1">Edge vendors (KEV watch)</span>
        <div className="flex-1 min-w-[180px]">
          <div className="flex flex-wrap gap-1 mb-1">
            {spec.edgeVendors.map((v) => (
              <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 flex items-center gap-1">
                {v}{canEdit && <button type="button" onClick={() => set({ edgeVendors: spec.edgeVendors.filter((x) => x !== v) })} className="text-slate-600 hover:text-red-400" aria-label={`Remove ${v}`}>✕</button>}
              </span>
            ))}
            {spec.edgeVendors.length === 0 && <span className="text-[10px] text-slate-600">none declared — KEV exposure reads UNKNOWN, never green</span>}
          </div>
          {canEdit && (
            <div className="flex gap-1">
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addVendor(); } }} placeholder="Cisco, Fortinet, Palo Alto, Ivanti…"
                className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600" />
              <button type="button" onClick={addVendor} className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-slate-600 text-slate-300 hover:border-emerald-500/50">Add</button>
            </div>
          )}
          <p className="text-[9.5px] text-slate-600 mt-1">Vendor or product names of the devices on the wing&apos;s networks and at host airports. KEV × these names is the whole exposure signal — never the NVD firehose.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] text-slate-400 w-36">Space activity boards</span>
        {seg(spec.spaceActivity, "On", () => set({ spaceActivity: true }))}
        {seg(!spec.spaceActivity, "Off", () => set({ spaceActivity: false }))}
        <span className="text-[9.5px] text-slate-600">— <code>space_activity</code> on AOI boards whose actor launches (China, Russia, Iran, North Korea); learning-mode for ~90 days.</span>
      </div>
    </div>
  );
}

// Must-tracks (REVIEW-2026-10 §6, decision 4): ★ the commands, countries and
// airfields that matter MOST. A ★ orders and pins — it never adds tracking.
// The OSINT command board's ★ taps write the same field (PATCH); this editor
// is the declaration view of it, saved with the rest of the profile.
function MustTrackEditor({ profile, canEdit, patch }: { profile: MissionProfile; canEdit: boolean; patch: (p: Partial<MissionProfile>) => void }) {
  const mt = profile.mustTrack ?? EMPTY_MUST_TRACK;
  const [icao, setIcao] = useState("");
  const set = (kind: "aor" | "country" | "icao", v: string) => patch({ mustTrack: toggleMustTrack(mt, kind, v) });
  const countries = [...new Set(profile.aois.flatMap((a) => a.countries))];
  const fields = [
    ...(profile.home ? [profile.home.icao] : profile.homeIcao ? [profile.homeIcao] : []),
    ...profile.spokes.map((s) => s.icao),
  ];
  const extraStars = mt.icaos.filter((i) => !fields.includes(i));
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" disabled={!canEdit} onClick={onClick}
      className={`text-[10.5px] font-mono px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${on ? "border-amber-500/50 text-amber-300 bg-amber-500/10" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}>
      {on ? "★ " : "☆ "}{label}
    </button>
  );
  return (
    <div className="border border-slate-800 rounded-lg p-3 space-y-2.5 bg-slate-950/40">
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">★ Must-tracks</label>
        <p className="text-[10px] text-slate-600 mt-0.5">What matters most. A ★ orders and pins on the OSINT command board (★ rows first, never folded; the primer breaks ties toward ★; ★ airfields take the {SITREP_MAX} full-SITREP slots, hub first; ★ commands always have a map chip). It never adds tracking by itself.</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5"><span className="text-[10.5px] text-slate-400 w-24">Commands</span>{AORS.map((a) => chip(mt.aors.includes(a), a, () => set("aor", a)))}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10.5px] text-slate-400 w-24">Countries</span>
        {countries.length === 0 && mt.countries.length === 0 && <span className="text-[10px] text-slate-600">declare an AOI first, or ★ a country row on the board</span>}
        {[...countries, ...mt.countries.filter((c) => !countries.some((x) => x.toLowerCase() === c.toLowerCase()))].map((c) => chip(isStarCountry(mt, c), c, () => set("country", c)))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10.5px] text-slate-400 w-24">Airfields</span>
        {[...fields, ...extraStars].map((i) => chip(mt.icaos.includes(i), i, () => set("icao", i)))}
        {canEdit && (
          <span className="flex items-center gap-1">
            <input value={icao} onChange={(e) => setIcao(e.target.value.toUpperCase().slice(0, 4))} onKeyDown={(e) => { if (e.key === "Enter" && /^[A-Z0-9]{4}$/.test(icao)) { e.preventDefault(); set("icao", icao); setIcao(""); } }} placeholder="ICAO" maxLength={4}
              className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 uppercase" />
            <button type="button" disabled={!/^[A-Z0-9]{4}$/.test(icao)} onClick={() => { set("icao", icao); setIcao(""); }} className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:border-amber-500/50 disabled:opacity-40">★ add</button>
          </span>
        )}
      </div>
    </div>
  );
}

interface ApplyPlanView {
  diff: { countriesAdd: string[]; countriesDrop: string[]; basesAdd: string[]; basesDrop: string[]; metarAdd: string[]; metarDrop: string[]; watchlistAdd: string[]; sitrep: { from: string[]; to: string[] }; drifted: string[]; empty: boolean };
  counts: { countries: number; bases: number; metarStations: number; sitrepBases: number; watchlistAdded: number };
}

// The dry-run diff — what Confirm will write, list by list. Drops are shown
// as loudly as adds: an AOI removed takes its AUTO rows with it.
function ApplyDiffView({ plan }: { plan: ApplyPlanView }) {
  const { diff, counts } = plan;
  const line = (label: string, add: string[], drop: string[]) => (add.length || drop.length) ? (
    <p className="text-[11px]"><span className="text-slate-400">{label}:</span>{" "}
      {add.length > 0 && <span className="text-emerald-300">+ {add.join(", ")}</span>}
      {add.length > 0 && drop.length > 0 && <span className="text-slate-600"> · </span>}
      {drop.length > 0 && <span className="text-red-300">− {drop.join(", ")}</span>}
    </p>
  ) : null;
  const sitrepChanged = diff.sitrep.from.join(",") !== diff.sitrep.to.join(",");
  return (
    <div className="border border-emerald-500/30 rounded-lg p-3 bg-emerald-500/[0.04] space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">What Confirm writes</p>
      {diff.empty && <p className="text-[11px] text-slate-400">Every list already matches the declaration — nothing to write.</p>}
      {line("Countries", diff.countriesAdd, diff.countriesDrop)}
      {line("Posture airfields", diff.basesAdd, diff.basesDrop)}
      {line("METAR / TAF", diff.metarAdd, diff.metarDrop)}
      {line("Watch terms", diff.watchlistAdd, [])}
      {sitrepChanged && <p className="text-[11px]"><span className="text-slate-400">SITREP slots:</span> <span className="text-slate-500">{diff.sitrep.from.join(", ") || "none"}</span> <span className="text-slate-600">→</span> <span className="text-emerald-300">{diff.sitrep.to.join(", ") || "none"}</span></p>}
      {diff.drifted.length > 0 && <p className="text-[10px] text-amber-300">Deleted since the last apply, now excluded: {diff.drifted.join(", ")}</p>}
      <p className="text-[10px] text-slate-500">After: {counts.countries} countries · {counts.bases} bases · {counts.metarStations} METAR · {counts.sitrepBases} SITREP. Manual rows are never touched.</p>
    </div>
  );
}

export default function MissionProfileEditor() {
  const [profile, setProfile] = useState<MissionProfile>(EMPTY_PROFILE);
  const [canEdit, setCanEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [sitrepPicks, setSitrepPicks] = useState<string[]>([]);
  // The live SITREP base set — picks default to it so hitting Apply never
  // silently replaces what you curated in the SITREP pane, and a base you
  // removed there is never resurrected by an unrelated Apply.
  const [currentSitrep, setCurrentSitrep] = useState<{ icao: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Autosave state: the declaration saves itself ~1.2 s after the last edit
  // (owner only, never before the first load). "Apply" is the deliberate
  // step that materializes; saving the declaration is not.
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<ApplyPlanView | null>(null);

  useEffect(() => {
    fetch("/api/mission-profile")
      .then((r) => r.json())
      .then((d) => {
        if (d?.profile) setProfile(d.profile);
        setCanEdit(!!d?.canEdit);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    fetch("/api/sitrep/bases")
      .then((r) => r.json())
      .then((d: { bases?: { icao: string; label: string }[] }) => {
        const bases = Array.isArray(d?.bases) ? d.bases : [];
        setCurrentSitrep(bases);
        setSitrepPicks(bases.map((b) => b.icao));
      })
      .catch(() => {});
  }, []);

  const preview = useMemo(() => (showPreview ? deriveTracking(profile) : null), [showPreview, profile]);

  // No auto-defaulting of picks beyond the live set: an Apply must never
  // change the SITREP bases unless the user deliberately changed the picks.

  const patch = (p: Partial<MissionProfile>) => { setProfile((prev) => ({ ...prev, ...p })); setMsg(null); setPlan(null); setDirty(true); };

  useEffect(() => {
    if (!dirty || !canEdit || !loaded) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/mission-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { setSaveErr(d.error || "Save failed"); return; }
        setSaveErr(null); setDirty(false);
        setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
        // ★ must-tracks and hub/spokes read live on the command board.
        window.dispatchEvent(new Event("force-locations:changed"));
      } catch { setSaveErr("Save failed — network"); }
    }, 1200);
    return () => clearTimeout(t);
  }, [dirty, profile, canEdit, loaded]);
  const patchAoi = (id: string, p: Partial<MissionAoi>) =>
    patch({ aois: profile.aois.map((a) => (a.id === id ? { ...a, ...p } : a)) });

  const addAoi = () => {
    const name = window.prompt("Name the area of interest (e.g. \"Iran & Hormuz\", \"Red Sea\"):")?.trim();
    if (!name) return;
    const id = slugify(name);
    if (profile.aois.some((a) => a.id === id)) return;
    patch({ aois: [...profile.aois, { id, name, aor: "CENTCOM", countries: [], intensity: "primary", iw: true, chokepointIds: [] }] });
  };

  const toggleExcluded = (id: string) => {
    const has = profile.excludedIds.includes(id);
    patch({ excludedIds: has ? profile.excludedIds.filter((x) => x !== id) : [...profile.excludedIds, id] });
  };

  // Apply = two steps: a dry run that shows exactly what each list gains and
  // loses (lib/missionApplyPlan — the same plan the real apply saves), then
  // the confirm. Nothing is written until the second click.
  const previewApply = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/mission-profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, sitrepPicks, dryRun: true }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ ok: false, text: d.error || "Could not plan the apply." }); return; }
      setPlan({ diff: d.diff, counts: d.counts });
    } finally { setBusy(false); }
  };

  const apply = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/mission-profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, sitrepPicks }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ ok: false, text: d.error || "Apply failed." }); return; }
      if (d.profile) { setProfile(d.profile); setDirty(false); }
      setPlan(null);
      const c = d.counts;
      setMsg({ ok: true, text: `Applied — ${c.countries} countries · ${c.bases} bases · ${c.sitrepBases} SITREP · ${c.metarStations} METAR · +${c.watchlistAdded} watch terms.` });
      fetch("/api/sitrep/bases").then((r) => r.json())
        .then((dd: { bases?: { icao: string; label: string }[] }) => {
          const bases = Array.isArray(dd?.bases) ? dd.bases : [];
          setCurrentSitrep(bases);
          setSitrepPicks(bases.map((b) => b.icao));
        }).catch(() => {});
      // Same refresh signals a Preferences save fires, so live surfaces reload.
      window.dispatchEvent(new Event("dashboard-cache-cleared"));
      window.dispatchEvent(new Event("force-locations:changed"));
      window.dispatchEvent(new Event("tracking:changed"));
    } finally { setBusy(false); }
  };

  if (!loaded) return <p className="text-[11px] text-slate-600">Loading mission profile…</p>;

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Declare what you command — the app derives the tracking (countries, bases, METAR stations, SITREP picks,
        chokepoint watch terms) from its curated hub/gateway network and theater data. Airfields flow into the
        Force posture + METAR + SITREP; tracked weather locations stay yours for civil places (home, family, TDY).
        Derived Force posture rows carry an{" "}
        <span className="text-emerald-400 font-mono text-[10px]">AUTO</span> tag; your manual entries are never
        touched, and anything you remove — anywhere — stays removed.
        {!canEdit && <span className="text-amber-400"> Shared team config — editable by the owner.</span>}
      </p>

      {/* Own force airfields — hub & spoke */}
      <OwnForceEditor profile={profile} canEdit={canEdit} patch={patch} />

      {/* Theaters */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Theaters you own</label>
        <div className="flex flex-wrap gap-1.5">
          {AORS.map((aor) => {
            const on = profile.theaters.includes(aor);
            return (
              <button
                key={aor} type="button" disabled={!canEdit}
                onClick={() => patch({ theaters: on ? profile.theaters.filter((t) => t !== aor) : [...profile.theaters, aor] })}
                className={`text-[11px] font-mono px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                  on ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10" : "border-slate-700 text-slate-500 hover:text-slate-300"
                }`}
              >
                {on ? "✓ " : ""}{aor}
              </button>
            );
          })}
        </div>
      </div>

      {/* Spectrum dependencies — team config, never sent to a model */}
      <SpectrumEditor profile={profile} canEdit={canEdit} patch={patch} />

      {/* Must-tracks — ★ commands / countries / airfields (the board's ★ taps write the same field) */}
      <MustTrackEditor profile={profile} canEdit={canEdit} patch={patch} />

      {/* AOIs */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Named areas of interest</label>
        <div className="space-y-2">
          {profile.aois.map((aoi) => (
            <AoiCard key={aoi.id} aoi={aoi} canEdit={canEdit}
              onChange={(p) => patchAoi(aoi.id, p)}
              onRemove={() => patch({ aois: profile.aois.filter((a) => a.id !== aoi.id) })}
            />
          ))}
          {canEdit && (
            <button type="button" onClick={addAoi}
              className="w-full text-[11px] text-slate-500 hover:text-emerald-400 border border-dashed border-slate-700 hover:border-emerald-500/40 rounded-lg py-2 transition-colors">
              ＋ Add area of interest
            </button>
          )}
          {profile.aois.length === 0 && !canEdit && <p className="text-[11px] text-slate-600">No areas of interest declared.</p>}
        </div>
      </div>

      {/* Preview + actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setShowPreview((v) => !v)}
          className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300 transition-colors">
          {showPreview ? "Hide" : "Review"} derived tracking {showPreview ? "▴" : "▾"}
        </button>
        {canEdit && (
          <>
            <button type="button" onClick={plan ? apply : previewApply} disabled={busy || (profile.aois.length === 0 && profile.spokes.length === 0 && !profile.homeIcao)}
              className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded disabled:opacity-40 ${plan ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400" : "border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10"}`}>
              {busy ? "…" : plan ? (plan.diff.empty ? "Nothing to apply" : "Confirm — write these changes") : "Apply — preview changes"}
            </button>
            {plan && <button type="button" onClick={() => setPlan(null)} className="text-[10px] font-bold uppercase tracking-wider px-2 py-1.5 text-slate-400 hover:text-slate-200">cancel</button>}
            <span className="text-[10px] text-slate-500 ml-auto">
              {saveErr ? <span className="text-red-400">{saveErr}</span> : dirty ? "saving…" : savedAt ? `declaration saved · ${savedAt}` : "autosaves as you edit"}
            </span>
          </>
        )}
      </div>
      {msg && <p className={`text-[11px] ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}

      {plan && <ApplyDiffView plan={plan} />}

      {showPreview && preview && (
        <div className="border border-slate-800 rounded-lg p-3 space-y-3 bg-slate-950/50">
          <p className="text-[10px] text-slate-600">
            Uncheck anything you don&apos;t want tracked — exclusions are remembered and never re-derived.
          </p>
          <PreviewGroup label={`Countries → posture watch (${preview.countries.length})`}
            items={preview.countries.map((c) => ({ id: c.id, text: `${c.country} · ${c.cocom}`, why: c.note ?? "" }))}
            excluded={profile.excludedIds} onToggle={toggleExcluded} canEdit={canEdit} />
          <PreviewGroup label={`Bases & gateways (${preview.bases.length})`}
            items={preview.bases.map((b) => ({ id: b.id, text: `${b.icao} · ${b.label}`, why: b.note ?? "" }))}
            excluded={profile.excludedIds} onToggle={toggleExcluded} canEdit={canEdit} />

          {/* SITREP picks */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
              SITREP full treatment — pick up to {SITREP_MAX}
            </p>
            <div className="space-y-0.5">
              {[...preview.sitrepCandidates,
                ...currentSitrep.filter((c) => !preview.sitrepCandidates.some((s) => s.icao === c.icao))
                  .map((c) => ({ icao: c.icao, label: `${c.label} (current)` }))].map((s) => {
                const on = sitrepPicks.includes(s.icao);
                return (
                  <label key={s.icao} className="flex items-center gap-2 text-[11px] text-slate-300">
                    <input type="checkbox" checked={on} disabled={!canEdit || (!on && sitrepPicks.length >= SITREP_MAX)}
                      onChange={() => setSitrepPicks((prev) => on ? prev.filter((i) => i !== s.icao) : [...prev, s.icao])} />
                    <span className="font-mono">{s.icao}</span>
                    <span className="text-slate-500 truncate">{s.label}</span>
                  </label>
                );
              })}
              {preview.sitrepCandidates.length === 0 && <p className="text-[10px] text-slate-600">Set a home station or a primary AOI first.</p>}
            </div>
            <p className="text-[9px] text-slate-600 mt-1">Picks start as your current SITREP set — Apply changes it only if you change them here. Unchecking everything keeps the current set.</p>
          </div>

          {preview.watchlistSeeds.length > 0 && (
            <p className="text-[10px] text-slate-500">
              <span className="font-bold uppercase tracking-widest text-slate-400">Watch terms seeded:</span>{" "}
              {preview.watchlistSeeds.join(" · ")}
            </p>
          )}
          {preview.warningProblems.length > 0 && (
            <p className="text-[10px] text-slate-500">
              <span className="font-bold uppercase tracking-widest text-slate-400">I&amp;W boards:</span>{" "}
              {preview.warningProblems.map((w) => `${w.aor} · ${w.name}`).join(" — ")}
              <span className="text-slate-600"> (board instantiation lands in the next phase)</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Hub-and-spoke own-force airfields. ICAOs are resolved to labeled points at
// entry time (/api/airfields/resolve → curated sets → OurAirports) so the
// profile stores full coordinates and the derivation stays pure client-side.
function OwnForceEditor({ profile, canEdit, patch }: {
  profile: MissionProfile; canEdit: boolean; patch: (p: Partial<MissionProfile>) => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resolve = async (icao: string): Promise<MissionSpoke | null> => {
    const r = await fetch(`/api/airfields/resolve?icao=${encodeURIComponent(icao)}`);
    if (!r.ok) return null;
    const d = await r.json();
    return { icao: d.icao, label: d.label, lat: d.lat, lon: d.lon, country: d.country ?? "" };
  };

  const addSpoke = async () => {
    const icao = input.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(icao) || busy) return;
    if (icao === profile.homeIcao || profile.spokes.some((s) => s.icao === icao)) { setInput(""); return; }
    setBusy(true); setErr(null);
    const sp = await resolve(icao);
    setBusy(false);
    if (!sp) { setErr(`Couldn't resolve ${icao} — check the ICAO.`); return; }
    patch({ spokes: [...profile.spokes, sp].slice(0, 8) });
    setInput("");
  };

  const setHome = async (raw: string) => {
    const icao = raw.toUpperCase().slice(0, 4);
    patch({ homeIcao: icao, home: null });
    if (/^[A-Z0-9]{4}$/.test(icao)) {
      const sp = await resolve(icao);
      if (sp) patch({ home: sp });
    }
  };

  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Own force airfields — hub &amp; spokes
      </label>
      <p className="text-[10px] text-slate-600 mb-1.5">
        Where your crews and aircraft live — distinct from your residence (Home Location, in the You group). Every field here gets METAR, force-protection watch, and SITREP candidacy.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 border border-emerald-500/40 bg-emerald-500/10 rounded-full pl-2 pr-1 py-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">Hub</span>
          <input
            value={profile.homeIcao}
            onChange={(e) => void setHome(e.target.value)}
            disabled={!canEdit}
            placeholder="KWRI"
            className="w-14 bg-transparent text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none disabled:opacity-50"
          />
          {profile.home && <span className="text-[10px] text-slate-500 max-w-[160px] truncate">{profile.home.label}</span>}
        </span>
        {profile.spokes.map((sp) => (
          <span key={sp.icao} className="inline-flex items-center gap-1.5 border border-slate-700 rounded-full px-2 py-0.5">
            <span className="text-[11px] font-mono font-bold text-slate-200">{sp.icao}</span>
            <span className="text-[10px] text-slate-500 max-w-[150px] truncate">{sp.label}</span>
            {canEdit && (
              <button type="button" onClick={() => patch({ spokes: profile.spokes.filter((x) => x.icao !== sp.icao) })}
                className="text-slate-600 hover:text-red-400 text-xs" title="Remove spoke">✕</button>
            )}
          </span>
        ))}
        {canEdit && profile.spokes.length < 8 && (
          <span className="inline-flex items-center gap-1">
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value.toUpperCase().slice(0, 4)); setErr(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addSpoke(); } }}
              placeholder="+ spoke ICAO"
              className="w-24 bg-slate-950 border border-dashed border-slate-700 rounded-full px-2 py-0.5 text-[11px] font-mono text-slate-300 placeholder-slate-600"
            />
            <button type="button" onClick={() => void addSpoke()} disabled={busy || input.length !== 4}
              className="text-[10px] font-bold text-slate-500 hover:text-emerald-400 disabled:opacity-40">
              {busy ? "…" : "add"}
            </button>
          </span>
        )}
      </div>
      {err && <p className="text-[10px] text-red-400 mt-1">{err}</p>}
    </div>
  );
}

function AoiCard({ aoi, canEdit, onChange, onRemove }: {
  aoi: MissionAoi; canEdit: boolean;
  onChange: (p: Partial<MissionAoi>) => void; onRemove: () => void;
}) {
  const [countryInput, setCountryInput] = useState("");
  const [showCountrySuggest, setShowCountrySuggest] = useState(false);
  const suggested = useMemo(() => suggestChokepoints(aoi.countries).slice(0, 3), [aoi.countries]);
  const countrySuggestions = useMemo(
    () => (showCountrySuggest ? suggestAoiCountries(aoi.aor, aoi.countries) : []),
    [showCountrySuggest, aoi.aor, aoi.countries],
  );

  const addCountry = () => {
    const names = countryInput.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    const have = new Set(aoi.countries.map((c) => c.toLowerCase()));
    onChange({ countries: [...aoi.countries, ...names.filter((n) => !have.has(n.toLowerCase()))].slice(0, 25) });
    setCountryInput("");
  };

  return (
    <div className="border border-slate-700/70 rounded-lg p-3 bg-slate-950/40 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold text-slate-200">{aoi.name}</span>
        <select value={aoi.aor} disabled={!canEdit} onChange={(e) => onChange({ aor: e.target.value as MissionAoi["aor"] })}
          className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-sky-300">
          {AORS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button type="button" disabled={!canEdit}
          onClick={() => onChange({ intensity: aoi.intensity === "primary" ? "watch" : "primary" })}
          title="Primary = SITREP candidates + I&W board · Watch = posture tracking only"
          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border disabled:opacity-50 ${
            aoi.intensity === "primary" ? "border-red-500/40 text-red-300 bg-red-500/10" : "border-amber-500/40 text-amber-300 bg-amber-500/10"
          }`}>
          {aoi.intensity}
        </button>
        {aoi.intensity === "primary" && (
          <label className="flex items-center gap-1 text-[10px] text-slate-500">
            <input type="checkbox" checked={aoi.iw} disabled={!canEdit} onChange={(e) => onChange({ iw: e.target.checked })} />
            I&amp;W board
          </label>
        )}
        {canEdit && (
          <button type="button" onClick={onRemove} className="ml-auto text-slate-600 hover:text-red-400 text-xs" title="Remove AOI">✕</button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {aoi.countries.map((c) => (
          <span key={c} className="inline-flex items-center gap-1 text-[10px] text-slate-300 border border-slate-700 rounded-full px-2 py-0.5">
            {c}
            {canEdit && (
              <button type="button" onClick={() => onChange({ countries: aoi.countries.filter((x) => x !== c) })}
                className="text-slate-600 hover:text-red-400">✕</button>
            )}
          </span>
        ))}
        {canEdit && (
          <span className="inline-flex items-center gap-1">
            <input
              value={countryInput}
              onChange={(e) => setCountryInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCountry(); } }}
              onBlur={addCountry}
              placeholder="+ country, country…"
              className="w-36 bg-slate-950 border border-slate-800 rounded-full px-2 py-0.5 text-[10px] text-slate-300 placeholder-slate-600"
            />
          </span>
        )}
      </div>

      {/* Theater country suggestions — the app proposes, you tap to add */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => setShowCountrySuggest((v) => !v)}
            className="text-[9px] uppercase tracking-widest text-slate-600 hover:text-emerald-400 font-bold transition-colors">
            {showCountrySuggest ? "▾" : "▸"} suggest countries ({aoi.aor})
          </button>
          {showCountrySuggest && countrySuggestions.slice(0, 14).map((c) => (
            <button key={c} type="button"
              onClick={() => onChange({ countries: [...aoi.countries, c].slice(0, 25) })}
              className="text-[9px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors">
              + {c}
            </button>
          ))}
          {showCountrySuggest && countrySuggestions.length === 0 && (
            <span className="text-[9px] text-slate-700">every {aoi.aor} country is already in the AOI</span>
          )}
        </div>
      )}

      {/* Chokepoints: suggested from the countries, toggleable */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">Chokepoints:</span>
        {[...new Set([...aoi.chokepointIds, ...suggested.map((s) => s.id)])].map((id) => {
          const cp = CHOKEPOINTS.find((c) => c.id === id);
          if (!cp) return null;
          const on = aoi.chokepointIds.includes(id);
          return (
            <button key={id} type="button" disabled={!canEdit}
              onClick={() => onChange({ chokepointIds: on ? aoi.chokepointIds.filter((x) => x !== id) : [...aoi.chokepointIds, id].slice(0, 4) })}
              className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors disabled:opacity-50 ${
                on ? "border-sky-500/50 text-sky-300 bg-sky-500/10" : "border-slate-700 text-slate-600 hover:text-slate-400"
              }`}>
              {on ? "✓ " : "+ "}{cp.name}
            </button>
          );
        })}
        {suggested.length === 0 && aoi.chokepointIds.length === 0 && (
          <span className="text-[9px] text-slate-700">none nearby (add countries)</span>
        )}
      </div>
    </div>
  );
}

function PreviewGroup({ label, items, excluded, onToggle, canEdit }: {
  label: string;
  items: { id: string; text: string; why: string }[];
  excluded: string[]; onToggle: (id: string) => void; canEdit: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <div className="space-y-0.5">
        {items.map((it) => {
          const off = excluded.includes(it.id);
          return (
            <label key={it.id} className={`flex items-center gap-2 text-[11px] ${off ? "text-slate-600 line-through" : "text-slate-300"}`}>
              <input type="checkbox" checked={!off} disabled={!canEdit} onChange={() => onToggle(it.id)} />
              <span className="truncate">{it.text}</span>
              {it.why && <span className="text-[9px] text-slate-600 truncate">{it.why}</span>}
              <span className="ml-auto text-[8px] font-mono font-bold text-emerald-400/80 bg-emerald-500/10 rounded px-1 flex-shrink-0">AUTO</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
