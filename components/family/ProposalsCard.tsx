"use client";

import { useState } from "react";
import { ExternalLinkIcon } from "@/lib/icons";
import type { FamilyProposals, SenderMention, DocumentProposal } from "@/lib/familyProposals";
import { mentionKey, docKey } from "@/lib/familyProposals";
import type { ProposalCategory } from "@/lib/senderDiscovery";
import { SENDER_CATEGORIES, SENDER_CATEGORY_LABEL } from "@/lib/familyProfile";
import { toast } from "@/lib/feedback";

// "Your mail already told me about these." Proposals mined from the messages
// the declared senders wrote — other organisations named in the text, and
// documents with a printed expiry — in the same model call the digest already
// makes. Nothing new is read. The model proposed, the server validated, and
// this card is where you dispose: one tap writes the roster row you would
// have typed; Never is permanent.
//
// Each row names the email it came from and the sentence around the mention
// (REVIEW-2026-10 F8) — a raw link told the operator nothing, so they had to
// go and look — and says what Track will do.

const ALL_CATEGORIES: ProposalCategory[] = ["biller", ...SENDER_CATEGORIES];
const CAT_LABEL: Record<string, string> = { biller: "Bill", ...SENDER_CATEGORY_LABEL };
const TRACKS: Record<string, string> = {
  biller: "its statements, their cadence and a silence watch if it stops writing",
  school: "its newsletters for deadlines, closures and forms",
  activity: "its sign-up windows, fees and schedule changes",
  medical: "appointments and records requests",
  travel: "bookings and check-in windows",
  admin: "renewals and notices",
  other: "whatever it sends, for dates and asks",
};

const fmtDate = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { day: "numeric", month: "short" }) : "";
};
const senderName = (from?: string): string => {
  if (!from) return "";
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : from.split("@")[0]).trim();
};

export default function ProposalsCard({ proposals, onChanged, accountEmail }: { proposals: FamilyProposals; onChanged?: () => void; accountEmail?: string }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<Record<string, ProposalCategory>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const senders = proposals.senders.filter((m) => !gone.has(m.domain ?? mentionKey(m.name)));
  const documents = proposals.documents.filter((d) => !gone.has(docKey(d.label)));
  if (senders.length === 0 && documents.length === 0) return null;

  const hide = (key: string) => setGone((s) => new Set(s).add(key));

  const acceptSender = async (m: SenderMention) => {
    if (!m.domain) return;
    const category = pick[m.domain] ?? m.category;
    setBusy(m.domain);
    try {
      const res = await fetch("/api/family/discover", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: m.domain, label: m.name, category }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Could not add it");
      hide(m.domain);
      toast.ok(`Tracking ${m.name}`, `as ${CAT_LABEL[category]} — its mail is read from the next digest`);
      onChanged?.();
    } catch (e) {
      toast.error("Could not add that sender", e);
    } finally { setBusy(null); }
  };

  const acceptDoc = async (d: DocumentProposal) => {
    setBusy(d.label);
    try {
      const res = await fetch("/api/family/discover", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "document", label: d.label, expiresISO: d.expiresISO, leadDays: d.leadDays }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Could not add it");
      hide(docKey(d.label));
      toast.ok(`Tracking ${d.label}`, `${d.kind === "renewal" ? "renew by" : "expires"} ${d.expiresISO}${d.leadDays ? ` · ${d.leadDays}d lead` : ""}`);
      onChanged?.();
    } catch (e) {
      toast.error("Could not add that document", e);
    } finally { setBusy(null); }
  };

  const dismiss = async (key: string, what: string) => {
    hide(key);
    const q = key.startsWith("sender:") ? `domain=${encodeURIComponent(key.slice(7))}` : `key=${encodeURIComponent(key)}`;
    const r = await fetch(`/api/family/discover?${q}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) toast.info(`Won't propose ${what} again`);
    else toast.error("Could not save that dismissal");
  };

  const gmailHref = (id: string) => `https://mail.google.com/mail/?${accountEmail ? `authuser=${encodeURIComponent(accountEmail)}` : ""}#all/${encodeURIComponent(id)}`;
  const btn = "flex-shrink-0 text-[9px] font-bold uppercase tracking-wider rounded px-2 py-1 border disabled:opacity-40";

  return (
    <div className="border border-sky-500/30 bg-sky-950/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-sky-500/20 bg-sky-500/[.05]">
        <span className="text-[11px] font-bold uppercase tracking-widest text-sky-300">✦ Your mail already mentions these</span>
        <span className="ml-auto text-[10px] text-slate-500">{senders.length + documents.length} to file · from mail you already read</span>
      </div>

      {senders.map((m) => {
        const key = m.domain ?? mentionKey(m.name);
        const chosen = m.domain ? (pick[m.domain] ?? m.category) : m.category;
        const src = m.sourceSubject ? `${senderName(m.sourceFrom) || "an email"}${m.sourceDate ? ` · ${fmtDate(m.sourceDate)}` : ""}` : "";
        return (
          <div key={key} className="flex items-start gap-3 px-3.5 py-2.5 border-t border-slate-800/50 first:border-t-0">
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] font-semibold text-slate-100">
                {m.name}
                <span className="ml-2 text-[10px] font-mono font-normal text-slate-500">{m.domain ?? "no address seen in the mail — add it by hand if you want it tracked"}</span>
              </span>
              <span className="block text-[11px] text-slate-400 mt-0.5 leading-snug">
                {m.sourceSubject && <>In <b className="text-slate-200 font-semibold">“{m.sourceSubject}”</b>{src ? ` (${src})` : ""}: </>}
                <b className="text-slate-300 font-medium">“{m.evidence}”</b>
                {m.sightings > 1 ? ` · mentioned in ${m.sightings} messages` : ""}
              </span>
              <span className="block text-[10px] text-slate-500 mt-0.5">
                Tracking it reads {TRACKS[chosen] ?? TRACKS.other} from the next digest.
                {m.sourceIds[0] && <> <a href={gmailHref(m.sourceIds[0])} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">open the email <ExternalLinkIcon size={11} className="inline -mt-px" /></a></>}
              </span>
            </span>
            {m.domain && (
              <select value={chosen} onChange={(e) => setPick((p) => ({ ...p, [m.domain as string]: e.target.value as ProposalCategory }))}
                className="flex-shrink-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-300">
                {ALL_CATEGORIES.map((k) => <option key={k} value={k}>{CAT_LABEL[k]}</option>)}
              </select>
            )}
            {m.domain && (
              <button onClick={() => acceptSender(m)} disabled={busy !== null}
                className={`${btn} border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`}>
                {busy === m.domain ? "…" : "＋ Track"}
              </button>
            )}
            <button onClick={() => dismiss(m.domain ? `sender:${m.domain}` : mentionKey(m.name), m.name)} disabled={busy !== null}
              className={`${btn} border-slate-700 text-slate-500 hover:text-slate-300`}>
              Never
            </button>
          </div>
        );
      })}

      {documents.map((d) => (
        <div key={docKey(d.label)} className="flex items-start gap-3 px-3.5 py-2 border-t border-slate-800/50">
          <span className="mt-0.5 w-[62px] flex-shrink-0 text-center text-[9px] font-bold uppercase tracking-wider rounded py-0.5 border text-slate-300 border-slate-600 bg-slate-700/30">
            {d.kind}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[12.5px] font-semibold text-slate-100">{d.label}</span>
            <span className="block text-[10px] font-mono text-slate-500">
              {d.kind === "renewal" ? "renew by" : "expires"} {d.expiresISO}{d.leadDays ? ` · ${d.leadDays}d lead (type default)` : ""}
            </span>
            <span className="block text-[10.5px] text-slate-500 mt-0.5">&ldquo;{d.evidence}&rdquo;</span>
          </span>
          <button onClick={() => acceptDoc(d)} disabled={busy !== null}
            className={`${btn} border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`}>
            {busy === d.label ? "…" : "＋ Track"}
          </button>
          <button onClick={() => dismiss(docKey(d.label), d.label)} disabled={busy !== null}
            className={`${btn} border-slate-700 text-slate-500 hover:text-slate-300`}>
            Never
          </button>
        </div>
      ))}

      <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
        Found in the bodies of mail from senders you already declared — nothing outside your roster was read, and
        no extra model call was made. A document is only proposed when the email printed its date; the app never
        guesses one. Track writes the roster row; Never is permanent.
      </p>
    </div>
  );
}
