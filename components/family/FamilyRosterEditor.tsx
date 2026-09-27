"use client";

import { useState } from "react";
import type { FamilyProfile, FamilyPerson, FamilySender, FamilyBiller, FamilyDocument, BillCadence } from "@/lib/familyProfile";
import { slug } from "@/lib/familyProfile";

// Declare the household. This roster is not cosmetic — it becomes the Gmail
// search the digest runs, so an empty roster reads no mail at all, and adding
// a sender is the only way this tab ever sees a message.

export default function FamilyRosterEditor({
  profile, onClose, onSaved,
}: { profile: FamilyProfile; onClose: () => void; onSaved: () => void }) {
  const [people, setPeople] = useState<FamilyPerson[]>(profile.people);
  const [senders, setSenders] = useState<FamilySender[]>(profile.senders);
  const [household, setHousehold] = useState(profile.includeHousehold);
  const [billers, setBillers] = useState<FamilyBiller[]>(profile.billers ?? []);
  const [documents, setDocuments] = useState<FamilyDocument[]>(profile.documents ?? []);
  const [bPattern, setBPattern] = useState("");
  const [bLabel, setBLabel] = useState("");
  const [bCadence, setBCadence] = useState<BillCadence>("monthly");
  const [bAuto, setBAuto] = useState(false);
  const [dLabel, setDLabel] = useState("");
  const [dExpires, setDExpires] = useState("");
  const [dLead, setDLead] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [pName, setPName] = useState("");
  const [pGrade, setPGrade] = useState("");
  const [pSchool, setPSchool] = useState("");
  const [pAdult, setPAdult] = useState(false);
  const [sPattern, setSPattern] = useState("");
  const [sPerson, setSPerson] = useState("");

  const addPerson = () => {
    const name = pName.trim();
    if (!name) return;
    setPeople((xs) => [...xs, {
      id: `p-${slug(name)}-${xs.length}`, name,
      role: pAdult ? "adult" : "child",
      ...(pGrade.trim() ? { grade: pGrade.trim() } : {}),
      ...(pSchool.trim() ? { school: pSchool.trim() } : {}),
    }]);
    setPName(""); setPGrade(""); setPSchool(""); setPAdult(false);
  };

  const addSender = () => {
    const pattern = sPattern.trim().toLowerCase().replace(/^@/, "");
    if (!pattern || !/^[a-z0-9@._+-]+$/.test(pattern)) { setErr("Use an email address or a bare domain."); return; }
    setErr(null);
    setSenders((xs) => [...xs, { id: `s-${slug(pattern)}-${xs.length}`, pattern, ...(sPerson ? { personId: sPerson } : {}) }]);
    setSPattern(""); setSPerson("");
  };

  const addBiller = () => {
    const pattern = bPattern.trim().toLowerCase().replace(/^@/, "");
    if (!pattern || !/^[a-z0-9@._+-]+$/.test(pattern)) { setErr("Use an email address or a bare domain."); return; }
    setErr(null);
    setBillers((xs) => [...xs, {
      id: `b-${slug(pattern)}-${xs.length}`, pattern,
      label: bLabel.trim() || pattern, cadence: bCadence, autopay: bAuto,
    }]);
    setBPattern(""); setBLabel(""); setBCadence("monthly"); setBAuto(false);
  };

  const addDocument = () => {
    const label = dLabel.trim();
    if (!label || !/^\d{4}-\d{2}-\d{2}$/.test(dExpires)) { setErr("A document needs a label and an expiry date."); return; }
    setErr(null);
    const lead = Number(dLead);
    setDocuments((xs) => [...xs, {
      id: `d-${slug(label)}-${xs.length}`, label, expiresISO: dExpires,
      ...(Number.isFinite(lead) && lead > 0 ? { leadDays: Math.round(lead) } : {}),
    }]);
    setDLabel(""); setDExpires(""); setDLead("");
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/family/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: { people, senders, includeHousehold: household, billers, documents } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Save failed");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  };

  const field = "bg-slate-950 border border-slate-800 focus:border-emerald-500/40 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-700 outline-none";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
          <h3 className="text-[12px] font-bold uppercase tracking-widest text-emerald-400">Family roster</h3>
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
        </div>

        <div className="p-4 space-y-5">
          <p className="text-[10.5px] text-slate-500 leading-relaxed">
            The senders you list here become the mail search this tab runs. Nothing outside them is ever read.
            A bare domain (<span className="font-mono text-slate-400">oakwood.org</span>) catches everyone at that
            school; a full address catches only that mailbox.
          </p>

          {/* people */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Who is in the household</p>
            <div className="space-y-1 mb-2">
              {people.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2 text-[11.5px] text-slate-300 bg-slate-800/40 rounded px-2.5 py-1.5">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-slate-500 text-[10px]">
                    {p.role === "adult" ? "adult" : [p.grade && `${p.grade} grade`, p.school].filter(Boolean).join(" · ") || "child"}
                  </span>
                  <button onClick={() => setPeople((xs) => xs.filter((_, j) => j !== i))} className="ml-auto text-slate-600 hover:text-red-400">×</button>
                </div>
              ))}
              {people.length === 0 && <p className="text-[10.5px] text-slate-600 italic">No one added yet.</p>}
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Name" className={`${field} w-28`} />
              <input value={pGrade} onChange={(e) => setPGrade(e.target.value)} placeholder="Grade" disabled={pAdult} className={`${field} w-20 disabled:opacity-30`} />
              <input value={pSchool} onChange={(e) => setPSchool(e.target.value)} placeholder="School" disabled={pAdult} className={`${field} flex-1 min-w-[8rem] disabled:opacity-30`} />
              <label className="flex items-center gap-1 text-[10px] text-slate-500">
                <input type="checkbox" checked={pAdult} onChange={(e) => setPAdult(e.target.checked)} className="accent-emerald-500" /> adult
              </label>
              <button onClick={addPerson} disabled={!pName.trim()} className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded px-2 py-1 disabled:opacity-30">Add</button>
            </div>
          </div>

          {/* senders */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Senders to watch</p>
            <div className="space-y-1 mb-2">
              {senders.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 text-[11.5px] bg-slate-800/40 rounded px-2.5 py-1.5">
                  <span className="font-mono text-slate-300">{s.pattern}</span>
                  {s.personId && <span className="text-[9.5px] text-slate-500">→ {people.find((p) => p.id === s.personId)?.name ?? "?"}</span>}
                  <button onClick={() => setSenders((xs) => xs.filter((_, j) => j !== i))} className="ml-auto text-slate-600 hover:text-red-400">×</button>
                </div>
              ))}
              {senders.length === 0 && <p className="text-[10.5px] text-slate-600 italic">No senders yet — the tab reads nothing until you add one.</p>}
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <input value={sPattern} onChange={(e) => setSPattern(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addSender(); }}
                placeholder="oakwood.org  or  coach@lincoln.k12.us" className={`${field} flex-1 min-w-[14rem] font-mono`} />
              <select value={sPerson} onChange={(e) => setSPerson(e.target.value)} className={`${field} w-32`}>
                <option value="">any person</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button onClick={addSender} disabled={!sPattern.trim()} className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded px-2 py-1 disabled:opacity-30">Add</button>
            </div>
          </div>

          {/* billers */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Billers (Household pane)</p>
            <p className="text-[10px] text-slate-600 mb-1.5 leading-relaxed">
              Cadence is what lets the silence watch tell &ldquo;quarterly&rdquo; apart from &ldquo;stopped&rdquo;.
              Mark autopay so the pane can lead with the bills that will <i>not</i> pay themselves.
            </p>
            <div className="space-y-1 mb-2">
              {billers.map((b, i) => (
                <div key={b.id} className="flex items-center gap-2 text-[11.5px] bg-slate-800/40 rounded px-2.5 py-1.5">
                  <span className="text-slate-300 font-semibold truncate">{b.label}</span>
                  <span className="font-mono text-[10px] text-slate-500 truncate">{b.pattern}</span>
                  <span className="text-[9px] uppercase tracking-wider text-slate-500">{b.cadence}</span>
                  {b.autopay && <span className="text-[9px] uppercase tracking-wider text-emerald-400">autopay</span>}
                  <button onClick={() => setBillers((xs) => xs.filter((_, j) => j !== i))} className="ml-auto text-slate-600 hover:text-red-400">×</button>
                </div>
              ))}
              {billers.length === 0 && <p className="text-[10.5px] text-slate-600 italic">No billers — the Household pane reads nothing.</p>}
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <input value={bLabel} onChange={(e) => setBLabel(e.target.value)} placeholder="Electric — Xcel" className={`${field} w-40`} />
              <input value={bPattern} onChange={(e) => setBPattern(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addBiller(); }}
                placeholder="xcelenergy.com" className={`${field} flex-1 min-w-[10rem] font-mono`} />
              <select value={bCadence} onChange={(e) => setBCadence(e.target.value as BillCadence)} className={`${field} w-24`}>
                <option value="monthly">monthly</option><option value="quarterly">quarterly</option>
                <option value="annual">annual</option><option value="irregular">irregular</option>
              </select>
              <label className="flex items-center gap-1 text-[10px] text-slate-500">
                <input type="checkbox" checked={bAuto} onChange={(e) => setBAuto(e.target.checked)} className="accent-emerald-500" /> autopay
              </label>
              <button onClick={addBiller} disabled={!bPattern.trim()} className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded px-2 py-1 disabled:opacity-30">Add</button>
            </div>
          </div>

          {/* documents */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Documents with an expiry</p>
            <p className="text-[10px] text-slate-600 mb-1.5 leading-relaxed">
              Typed in once — a passport expiry never arrives by email. <b className="text-slate-500">Lead days</b> is
              how far before expiry it stops being usable: 183 for a passport, because most destinations demand six
              months&rsquo; validity.
            </p>
            <div className="space-y-1 mb-2">
              {documents.map((d, i) => (
                <div key={d.id} className="flex items-center gap-2 text-[11.5px] bg-slate-800/40 rounded px-2.5 py-1.5">
                  <span className="text-slate-300 font-semibold truncate">{d.label}</span>
                  <span className="font-mono text-[10px] text-slate-500">{d.expiresISO}</span>
                  {d.leadDays ? <span className="text-[9px] text-slate-500">{d.leadDays}d lead</span> : null}
                  <button onClick={() => setDocuments((xs) => xs.filter((_, j) => j !== i))} className="ml-auto text-slate-600 hover:text-red-400">×</button>
                </div>
              ))}
              {documents.length === 0 && <p className="text-[10.5px] text-slate-600 italic">None yet.</p>}
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <input value={dLabel} onChange={(e) => setDLabel(e.target.value)} placeholder="Passport — Emma" className={`${field} flex-1 min-w-[10rem]`} />
              <input value={dExpires} onChange={(e) => setDExpires(e.target.value)} placeholder="2027-02-14" className={`${field} w-28 font-mono`} />
              <input value={dLead} onChange={(e) => setDLead(e.target.value)} placeholder="lead days" className={`${field} w-24`} />
              <button onClick={addDocument} disabled={!dLabel.trim() || !dExpires.trim()} className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded px-2 py-1 disabled:opacity-30">Add</button>
            </div>
          </div>

          <label className="flex items-start gap-2 text-[11px] text-slate-300">
            <input type="checkbox" checked={household} onChange={(e) => setHousehold(e.target.checked)} className="accent-emerald-500 mt-0.5" />
            <span>Include household items — appointments, travel, insurance, visiting family — alongside school.</span>
          </label>

          {err && <p className="text-[11px] text-red-400">{err}</p>}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-800">
          <button onClick={onClose} className="text-[11px] text-slate-500 hover:text-slate-300">Cancel</button>
          <button onClick={save} disabled={busy} className="ml-auto text-[11px] font-bold uppercase tracking-wider bg-emerald-500 text-slate-950 rounded px-4 py-1.5 disabled:opacity-40">
            {busy ? "Saving…" : "Save roster"}
          </button>
        </div>
      </div>
    </div>
  );
}
