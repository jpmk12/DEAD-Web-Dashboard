"use client";

import { useEffect, useMemo, useState } from "react";
import {
  deriveTracking, suggestChokepoints, slugify, EMPTY_PROFILE, SITREP_MAX,
  type MissionProfile, type MissionAoi,
} from "@/lib/missionProfile";
import { CHOKEPOINTS } from "@/lib/chokepoints";
import type { Aor } from "@/lib/aor";

// Mission Profile editor — declare home station, theaters, and named AOIs;
// preview the derived tracking (client-side, lib/missionProfile is pure);
// exclude anything unwanted; then APPLY to materialize into the existing
// tracking lists. Owner-only writes (crew see a read-only declaration).

const AORS: Aor[] = ["CENTCOM", "EUCOM", "AFRICOM", "INDOPACOM", "SOUTHCOM", "NORTHCOM"];

export default function MissionProfileEditor() {
  const [profile, setProfile] = useState<MissionProfile>(EMPTY_PROFILE);
  const [canEdit, setCanEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [sitrepPicks, setSitrepPicks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/mission-profile")
      .then((r) => r.json())
      .then((d) => {
        if (d?.profile) setProfile(d.profile);
        setCanEdit(!!d?.canEdit);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const preview = useMemo(() => (showPreview ? deriveTracking(profile) : null), [showPreview, profile]);

  // Default SITREP picks: first ≤4 candidates, once per preview open.
  useEffect(() => {
    if (preview && sitrepPicks.length === 0 && preview.sitrepCandidates.length > 0) {
      setSitrepPicks(preview.sitrepCandidates.slice(0, SITREP_MAX).map((s) => s.icao));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  const patch = (p: Partial<MissionProfile>) => { setProfile((prev) => ({ ...prev, ...p })); setMsg(null); };
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

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/mission-profile", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile }),
      });
      const d = await res.json();
      setMsg(res.ok ? { ok: true, text: "Declaration saved (nothing materialized yet — use Apply)." } : { ok: false, text: d.error || "Save failed." });
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
      if (d.profile) setProfile(d.profile);
      const c = d.counts;
      setMsg({ ok: true, text: `Applied — ${c.countries} countries · ${c.bases} bases · ${c.sitrepBases} SITREP · ${c.weatherPoints} wx pts · +${c.watchlistAdded} watch terms.` });
      // Same refresh signals a Preferences save fires, so live surfaces reload.
      window.dispatchEvent(new Event("dashboard-cache-cleared"));
      window.dispatchEvent(new Event("force-locations:changed"));
    } finally { setBusy(false); }
  };

  if (!loaded) return <p className="text-[11px] text-slate-600">Loading mission profile…</p>;

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Declare what you command — the app derives the tracking (countries, bases, SITREP picks, weather points,
        watch terms) from its curated hub/gateway network and theater data. Derived rows carry an{" "}
        <span className="text-emerald-400 font-mono text-[10px]">AUTO</span> tag in the editors below; your manual
        entries are never touched, and anything you remove stays removed.
        {!canEdit && <span className="text-amber-400"> Shared team config — editable by the owner.</span>}
      </p>

      {/* Home station */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Home station (ICAO)</label>
        <input
          value={profile.homeIcao}
          onChange={(e) => patch({ homeIcao: e.target.value.toUpperCase().slice(0, 4) })}
          disabled={!canEdit}
          placeholder="KWRI"
          className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono text-slate-200 placeholder-slate-600 disabled:opacity-50"
        />
      </div>

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
            <button type="button" onClick={save} disabled={busy}
              className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-40">
              Save declaration
            </button>
            <button type="button" onClick={apply} disabled={busy || profile.aois.length === 0}
              className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40">
              {busy ? "…" : "Apply — materialize tracking"}
            </button>
          </>
        )}
      </div>
      {msg && <p className={`text-[11px] ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}

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
          <PreviewGroup label={`Weather points (${preview.weatherPoints.length})`}
            items={preview.weatherPoints.map((w) => ({ id: w.id, text: w.label, why: "" }))}
            excluded={profile.excludedIds} onToggle={toggleExcluded} canEdit={canEdit} />

          {/* SITREP picks */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
              SITREP full treatment — pick up to {SITREP_MAX}
            </p>
            <div className="space-y-0.5">
              {preview.sitrepCandidates.map((s) => {
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
            <p className="text-[9px] text-slate-600 mt-1">Applying with picks replaces the SITREP base set; with none selected the current set is kept.</p>
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

function AoiCard({ aoi, canEdit, onChange, onRemove }: {
  aoi: MissionAoi; canEdit: boolean;
  onChange: (p: Partial<MissionAoi>) => void; onRemove: () => void;
}) {
  const [countryInput, setCountryInput] = useState("");
  const suggested = useMemo(() => suggestChokepoints(aoi.countries).slice(0, 3), [aoi.countries]);

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
