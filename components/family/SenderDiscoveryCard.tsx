"use client";

import { useEffect, useRef, useState } from "react";
import type { SenderCandidate, ProposalCategory } from "@/lib/senderDiscovery";
import { SENDER_CATEGORIES, SENDER_CATEGORY_LABEL, SENDER_CATEGORY_TRACKS } from "@/lib/familyProfile";
import { toast } from "@/lib/feedback";

// Sender discovery, shared by the Household and School panes.
//
// Lifted out of HouseholdPane so the School pane can offer the same proposals
// where school and activity senders are the point — a new swim club is one tap
// from being tracked on the surface where its deadlines will appear, instead of
// living only under "billers". One component, one set of rules:
//
//   A DELIBERATE POST — the scan runs when Scan is pressed, or, when the roster
//   has `autoDiscover` on, when this card mounts and the last automatic scan is
//   more than a week old. Never on a poll or a digest. (The route is a POST
//   for the same reason.)
//   HEADERS ONLY — enforced by the route's Gmail metadata request shape.
//   PROPOSE, THEN DISPOSE — the classifier's category pre-fills a dropdown the
//   user can override; a close call is said out loud. "Track all" accepts
//   every row with the category currently shown.
//   SEED FROM A LABEL — the user's own Gmail label ("School", "Bills") is
//   filing they already did; every undeclared sender in it is proposed.
//   NOTHING STORED BUT YOUR ANSWER — Track writes a roster row; Never writes a
//   permanent dismissal.

// Biller first: it is the category with the most machinery behind it (cadence,
// silence watch, amount history), so it leads the dropdown.
const ALL_CATEGORIES: ProposalCategory[] = ["biller", ...SENDER_CATEGORIES];
const CAT_LABEL: Record<string, string> = { biller: "Bill", ...SENDER_CATEGORY_LABEL };
const TRACKS: Record<string, string> = {
  biller: "amounts, cadence and a silence watch if it stops writing",
  ...SENDER_CATEGORY_TRACKS,
};

const AUTO_KEY = "family.discover.lastAuto";
const AUTO_EVERY_MS = 7 * 86_400_000;

export default function SenderDiscoveryCard({ heading, intro, onAccepted, autoDiscover = false, exclude = [] }: {
  heading: string;
  /** One sentence on why this pane wants the scan. */
  intro: string;
  /** Called after a proposal is written into the roster, so the owning pane can reload. */
  onAccepted?: () => void;
  /** From the roster: run the scan by itself about weekly on mount. */
  autoDiscover?: boolean;
  /** Categories this pane does not own (REVIEW-2026-10 F9): a school sender
   *  proposed on the Household pane belongs to the School pane, not here. */
  exclude?: ProposalCategory[];
}) {
  // Discovery is null until the user has scanned at least once — an empty array
  // means "scanned, found nothing", and the two read very differently.
  const [discovery, setDiscovery] = useState<SenderCandidate[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  // Per-domain category override; absent means "use the classifier's guess".
  const [pick, setPick] = useState<Record<string, ProposalCategory>>({});
  const [adding, setAdding] = useState<string | null>(null);
  // Labels: fetched on first focus of the seed control, never on mount. A
  // native <select> rather than a hand-rolled popover — it lays itself out,
  // scrolls, and reads on a phone.
  const [labels, setLabels] = useState<string[] | null>(null);
  const autoFired = useRef(false);

  const runDiscovery = async (label?: string) => {
    setDiscovering(true);
    try {
      const res = await fetch("/api/family/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(label ? { label } : {}),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Scan failed");
      setDiscovery(Array.isArray(j?.candidates) ? j.candidates : []);
      setSeededFrom(typeof j?.seededFrom === "string" ? j.seededFrom : null);
      setPick({});
    } catch (e) {
      toast.error("Scan failed", e);
    } finally {
      setDiscovering(false);
    }
  };

  // Weekly automatic scan. The stamp is written BEFORE the request so two
  // mounted cards (the School and Household panes both host one) cannot both
  // fire, and a failed scan does not retry on every open.
  useEffect(() => {
    if (!autoDiscover || autoFired.current) return;
    autoFired.current = true;
    let last = 0;
    try { last = Number(localStorage.getItem(AUTO_KEY) ?? 0) || 0; } catch { /* ignore */ }
    const age = Date.now() - last;
    if (last && age < AUTO_EVERY_MS) {
      setAutoNote(`last automatic scan ${Math.max(1, Math.round(age / 86_400_000))}d ago`);
      return;
    }
    try { localStorage.setItem(AUTO_KEY, String(Date.now())); } catch { /* ignore */ }
    setAutoNote("scanned automatically just now");
    runDiscovery();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDiscover]);

  const loadLabels = async () => {
    if (labels !== null) return;
    try {
      const r = await fetch("/api/family/discover?labels=1");
      const j = await r.json().catch(() => null);
      setLabels(Array.isArray(j?.labels) ? j.labels : []);
    } catch { setLabels([]); }
  };

  const dismissDomain = async (domain: string) => {
    setDiscovery((prev) => (prev ?? []).filter((c) => c.domain !== domain));
    const r = await fetch(`/api/family/discover?domain=${encodeURIComponent(domain)}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) toast.info(`Won't propose ${domain} again`);
    else toast.error("Could not save that dismissal");
  };

  const acceptOne = async (c: SenderCandidate, category: ProposalCategory): Promise<boolean> => {
    const res = await fetch("/api/family/discover", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: c.domain, label: c.name, category }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error || "Could not add it");
    setDiscovery((prev) => (prev ?? []).filter((x) => x.domain !== c.domain));
    return true;
  };

  const acceptDomain = async (c: SenderCandidate, category: ProposalCategory) => {
    setAdding(c.domain);
    try {
      await acceptOne(c, category);
      // Drop the accepted row and reload the digest, so the new sender's mail is
      // read on this pass rather than looking like nothing happened.
      toast.ok(`Tracking ${c.name}`, `as ${CAT_LABEL[category]} — its dates start appearing on the next digest`);
      onAccepted?.();
    } catch (e) {
      toast.error("Could not add that sender", e);
    } finally {
      setAdding(null);
    }
  };

  // The rows this pane shows: the scan is shared, the ownership is not.
  const shown = discovery === null ? null : discovery.filter((c) => !exclude.includes(c.category));

  const acceptAll = async () => {
    const rows = shown ?? [];
    if (rows.length === 0) return;
    setAdding("*");
    let ok = 0;
    for (const c of rows) {
      try { await acceptOne(c, pick[c.domain] ?? c.category); ok++; }
      catch { /* keep going; the row stays for a retry */ }
    }
    setAdding(null);
    if (ok) { toast.ok(`Tracking ${ok} sender${ok === 1 ? "" : "s"}`, "each in the category shown"); onAccepted?.(); }
    if (ok < rows.length) toast.error(`${rows.length - ok} could not be added`);
  };

  return (
    <>
      <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">{heading}</span>
          {autoNote && <span className="text-[9.5px] text-slate-600">· {autoNote}</span>}
          <span className="ml-auto flex items-center gap-1.5">
            <select
              value=""
              onFocus={loadLabels}
              onMouseDown={loadLabels}
              onChange={(e) => { if (e.target.value) runDiscovery(e.target.value); }}
              disabled={discovering}
              title="Propose every undeclared sender in one of your own Gmail labels"
              className="max-w-[190px] bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-300 disabled:opacity-40"
            >
              <option value="">Seed from label…</option>
              {labels === null && <option value="" disabled>loading labels…</option>}
              {labels?.length === 0 && <option value="" disabled>no user labels in this account</option>}
              {labels?.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button
              onClick={() => runDiscovery()}
              disabled={discovering}
              className="text-[9.5px] font-bold uppercase tracking-wider rounded px-2.5 py-1 border border-sky-500/50 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-40"
            >
              {discovering ? "Scanning…" : "Scan"}
            </button>
          </span>
        </div>

        {shown === null ? (
          <p className="px-3.5 py-2 text-[10px] text-slate-600 leading-snug">
            {intro} This checks the last 120 days for category-shaped subjects from senders you have NOT declared. It reads subject lines and addresses only, never message bodies.
            {autoDiscover ? " It runs by itself about once a week when you open this tab; Scan runs it now." : " It runs only when you press Scan."}
            {" "}Seed from label proposes everyone in one of your own Gmail labels instead.
          </p>
        ) : shown.length === 0 ? (
          <p className="px-3.5 py-2 text-[10px] text-slate-600 leading-snug">
            {seededFrom
              ? <>Nothing undeclared in your &ldquo;{seededFrom}&rdquo; label from the last year.</>
              : <>Nothing new in the last 120 days. That is not a guarantee there is no undeclared biller — only that none wrote with a billing-shaped subject in the window scanned.</>}
          </p>
        ) : (
          <>
            {seededFrom && (
              <p className="px-3.5 py-1.5 text-[10px] text-sky-300/80 border-b border-slate-800/60">
                From your &ldquo;{seededFrom}&rdquo; label — the label is the evidence, so the category is a guess. Check the dropdowns, then Track all.
              </p>
            )}
            {shown.map((c) => {
              const chosen = pick[c.domain] ?? c.category;
              return (
                <div key={c.domain} className="flex items-start gap-3 px-3.5 py-2 border-t border-slate-800/50">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] font-semibold text-slate-100">{c.name}</span>
                    <span className="block text-[10px] font-mono text-slate-500">{c.domain}</span>
                    <span className="block text-[10.5px] text-slate-500 mt-0.5">{c.reason}</span>
                    {c.confidence === "close" && c.alternate && (
                      <span className="block text-[9.5px] text-amber-400/80 mt-0.5">
                        Close call — could equally be {CAT_LABEL[c.alternate]}. Worth a look before adding.
                      </span>
                    )}
                    {c.examples.length > 0 && (
                      <span className="block text-[9.5px] text-slate-600 mt-0.5 truncate">e.g. &ldquo;{c.examples[0]}&rdquo;</span>
                    )}
                    <span className="block text-[9.5px] text-slate-600 mt-0.5">
                      Tracks {TRACKS[chosen]}.
                    </span>
                  </span>

                  {/* The classifier proposes; the dropdown lets you dispose. A
                      mis-filed sender costs one click here and is expensive to
                      leave silently wrong. */}
                  <select
                    value={chosen}
                    onChange={(e) => setPick((p) => ({ ...p, [c.domain]: e.target.value as ProposalCategory }))}
                    className="flex-shrink-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-300"
                  >
                    {ALL_CATEGORIES.map((k) => (
                      <option key={k} value={k}>{CAT_LABEL[k]}</option>
                    ))}
                  </select>

                  <button
                    onClick={() => acceptDomain(c, chosen)}
                    disabled={adding !== null}
                    className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                  >
                    {adding === c.domain ? "…" : "＋ Track"}
                  </button>
                  <button
                    onClick={() => dismissDomain(c.domain)}
                    disabled={adding !== null}
                    className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-500 hover:text-slate-300 disabled:opacity-40"
                  >
                    Never
                  </button>
                </div>
              );
            })}
            <div className="flex items-center gap-3 px-3.5 py-2 border-t border-slate-800">
              <p className="flex-1 text-[9.5px] text-slate-600 leading-snug">
                ＋ Track writes the sender straight into your roster in the category shown, so its dates start being
                tracked on the next digest. A new biller starts with cadence <span className="font-mono">auto</span> —
                learned from its statements; the silence watch never accuses a biller it has only just met.
                Declining is permanent.
              </p>
              {shown.length > 1 && (
                <button onClick={acceptAll} disabled={adding !== null}
                  className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider rounded px-2.5 py-1 border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40">
                  {adding === "*" ? "Adding…" : `＋ Track all ${shown.length}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>

    </>
  );
}
