"use client";

import { useState } from "react";
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
//   ON DEMAND ONLY — the scan runs when Scan is pressed. Never on a page load,
//   a poll or a digest. (The route is a POST for the same reason.)
//   HEADERS ONLY — enforced by the route's Gmail metadata request shape.
//   PROPOSE, THEN DISPOSE — the classifier's category pre-fills a dropdown the
//   user can override; a close call is said out loud.
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

export default function SenderDiscoveryCard({ heading, intro, onAccepted }: {
  heading: string;
  /** One sentence on why this pane wants the scan. */
  intro: string;
  /** Called after a proposal is written into the roster, so the owning pane can reload. */
  onAccepted?: () => void;
}) {
  // Discovery is null until the user has scanned at least once — an empty array
  // means "scanned, found nothing", and the two read very differently.
  const [discovery, setDiscovery] = useState<SenderCandidate[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  // Per-domain category override; absent means "use the classifier's guess".
  const [pick, setPick] = useState<Record<string, ProposalCategory>>({});
  const [adding, setAdding] = useState<string | null>(null);

  const runDiscovery = async () => {
    setDiscovering(true);
    try {
      const res = await fetch("/api/family/discover", { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Scan failed");
      setDiscovery(Array.isArray(j?.candidates) ? j.candidates : []);
    } catch (e) {
      toast.error("Scan failed", e);
    } finally {
      setDiscovering(false);
    }
  };

  const dismissDomain = async (domain: string) => {
    setDiscovery((prev) => (prev ?? []).filter((c) => c.domain !== domain));
    const r = await fetch(`/api/family/discover?domain=${encodeURIComponent(domain)}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) toast.info(`Won't propose ${domain} again`);
    else toast.error("Could not save that dismissal");
  };

  const acceptDomain = async (c: SenderCandidate, category: ProposalCategory) => {
    setAdding(c.domain);
    try {
      const res = await fetch("/api/family/discover", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: c.domain, label: c.name, category }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Could not add it");
      // Drop the accepted row and reload the digest, so the new sender's mail is
      // read on this pass rather than looking like nothing happened.
      setDiscovery((prev) => (prev ?? []).filter((x) => x.domain !== c.domain));
      toast.ok(`Tracking ${c.name}`, `as ${CAT_LABEL[category]} — its dates start appearing on the next digest`);
      onAccepted?.();
    } catch (e) {
      toast.error("Could not add that sender", e);
    } finally {
      setAdding(null);
    }
  };

  return (
    <>
      <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">{heading}</span>
          <button
            onClick={runDiscovery}
            disabled={discovering}
            className="ml-auto text-[9.5px] font-bold uppercase tracking-wider rounded px-2.5 py-1 border border-sky-500/50 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-40"
          >
            {discovering ? "Scanning…" : "Scan"}
          </button>
        </div>

        {discovery === null ? (
          <p className="px-3.5 py-2 text-[10px] text-slate-600 leading-snug">
            {intro} This checks the last 120 days for category-shaped subjects from senders you have NOT declared. It reads subject lines and addresses only, never message bodies, and runs only when you press Scan.
          </p>
        ) : discovery.length === 0 ? (
          <p className="px-3.5 py-2 text-[10px] text-slate-600 leading-snug">
            Nothing new in the last 120 days. That is not a guarantee there is no undeclared biller — only that none
            wrote with a billing-shaped subject in the window scanned.
          </p>
        ) : (
          <>
            {discovery.map((c) => {
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
            <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
              ＋ Track writes the sender straight into your roster in the category shown, so its dates start being
              tracked on the next digest. A new biller starts as <span className="font-mono">irregular</span> — the
              scan cannot know a cadence, and the silence watch must never accuse a biller it has only just met.
              Declining is permanent.
            </p>
          </>
        )}
      </div>

    </>
  );
}
