import { EmailMessage, EmailPriority } from "@/lib/types";
import { formatDistanceToNow, parseISO } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { FAMILY_LABELS } from "@/lib/familyLabels";
import { FamilyFileIcon } from "@/lib/icons";
import { toast } from "@/lib/feedback";
import { senderAddress } from "@/lib/emailLearning";

// One email (REVIEW-2026-10 §4). Two renderings of the same data:
//   - FULL (High / Medium, or a Low row the user opened): sender, badge menu,
//     keep chip, subject, the WHY line, summary, the action row;
//   - COMPACT (Low): one line — checkbox · sender · subject · why · age ·
//     badge · ✓ — because the Low pass is a scan; tap the row to open it.
// The checkbox SELECTS; the row OPENS. The priority badge is a menu: set
// this email's priority now, or make the sender Always High / Always Low.

export interface EmailCardHandlers {
  onToggle: (id: string) => void;
  onExpand?: (id: string | null) => void;
  onMarkRead: (email: EmailMessage) => void;
  onSetPriority: (email: EmailMessage, priority: EmailPriority | null) => void;
  onKeep: (email: EmailMessage, keep: boolean) => void;
  onSenderRule: (email: EmailMessage, kind: "high" | "low") => void;
}

interface EmailCardProps extends EmailCardHandlers {
  email: EmailMessage;
  selected: boolean;
  previousSeen?: number;
  compact?: boolean;
  expanded?: boolean;
  focused?: boolean;
  /** Show the account dot (only when a second account is connected). */
  showAccount?: boolean;
  busy?: boolean;
}

const PRIORITY_CONFIG: Record<EmailPriority, { badge: string; bar: string; dot: string }> = {
  High: { badge: "bg-red-500/15 text-red-400 border border-red-500/40 hover:bg-red-500/25", bar: "bg-red-500", dot: "bg-red-500" },
  Medium: { badge: "bg-amber-500/15 text-amber-400 border border-amber-500/40 hover:bg-amber-500/25", bar: "bg-amber-500", dot: "bg-amber-500" },
  Low: { badge: "bg-slate-700/60 text-slate-400 border border-slate-700 hover:bg-slate-700", bar: "bg-slate-700", dot: "bg-slate-500" },
};
const PRIORITIES: EmailPriority[] = ["High", "Medium", "Low"];

function parseSender(from: string) {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].replace(/"/g, "").trim(), email: match[2] };
  return { name: from, email: from };
}

export function gmailLink(email: EmailMessage): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email.accountEmail)}#all/${encodeURIComponent(email.id)}`;
}

type SaveState = "idle" | "saving" | "saved" | "error";
type DraftState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "review"; text: string }
  | { phase: "saving"; text: string }
  | { phase: "saved" }
  | { phase: "error"; message: string };

interface TaskPlan { title: string; due?: string; notes?: string }
interface EventPlan { summary: string; start: string; end: string; location?: string }
type ConvertState =
  | { phase: "idle" }
  | { phase: "loading"; kind: "task" | "event" }
  | { phase: "review"; kind: "task"; plan: TaskPlan }
  | { phase: "review"; kind: "event"; plan: EventPlan }
  | { phase: "saving" }
  | { phase: "saved"; what: string }
  | { phase: "error"; message: string };

const ACT = "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border transition-all whitespace-nowrap";
const ACT_IDLE = `${ACT} border-slate-700/80 text-slate-400 hover:text-slate-200 hover:border-slate-500`;

/** The priority badge + its menu. */
function PriorityMenu({ email, busy, onSetPriority, onSenderRule, small }: { email: EmailMessage; busy?: boolean; small?: boolean } & Pick<EmailCardHandlers, "onSetPriority" | "onSenderRule">) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const cfg = PRIORITY_CONFIG[email.priority];
  const addr = senderAddress(email.from);
  const overridden = !!email.prioritySet;
  return (
    <span className="relative inline-flex" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={overridden ? `You set ${email.priority}${email.priorityModel && email.priorityModel !== email.priority ? ` (model said ${email.priorityModel})` : ""} — change` : "Change priority"}
        className={`inline-flex items-center gap-1 font-bold rounded-md transition-all ${small ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-0.5"} ${cfg.badge} ${busy ? "opacity-50 cursor-wait" : ""}`}
      >
        {email.priority}
        {overridden && <span className="text-[8px] font-bold tracking-wider text-violet-300">you</span>}
        <span className="text-[8px] opacity-70">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-40 min-w-[250px] rounded-lg border border-slate-700 bg-slate-950 shadow-2xl p-1.5 text-left normal-case tracking-normal">
          <p className="px-2 pt-1 pb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">Set priority for this email</p>
          {PRIORITIES.map((p, i) => {
            const isCurrent = email.priority === p;
            const isModel = email.priorityModel === p;
            return (
              <button key={p} role="menuitem" onClick={() => { setOpen(false); if (!isCurrent) onSetPriority(email, p); }}
                className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 text-[12px] ${isCurrent ? "bg-emerald-500/10 text-emerald-300" : "text-slate-200 hover:bg-slate-800"}`}>
                <span className={`w-2 h-2 rounded-full ${PRIORITY_CONFIG[p].dot}`} />
                <span className="font-semibold">{p}</span>
                <span className="ml-auto text-[9.5px] font-mono text-slate-500">{isModel ? "model’s call" : String(i + 1)}</span>
              </button>
            );
          })}
          {overridden && email.priorityModel && (
            <button role="menuitem" onClick={() => { setOpen(false); onSetPriority(email, null); }}
              className="w-full text-left px-2 py-1.5 rounded text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200">
              Clear my override — back to the model’s {email.priorityModel}
            </button>
          )}
          {addr && (
            <>
              <div className="h-px bg-slate-800 my-1" />
              <p className="px-2 pt-0.5 pb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">From this sender, every time</p>
              <button role="menuitem" onClick={() => { setOpen(false); onSenderRule(email, "high"); }} className="w-full text-left px-2 py-1.5 rounded text-[11.5px] text-slate-200 hover:bg-slate-800">
                Always High — <span className="font-mono text-slate-400">{addr}</span>
              </button>
              <button role="menuitem" onClick={() => { setOpen(false); onSenderRule(email, "low"); }} className="w-full text-left px-2 py-1.5 rounded text-[11.5px] text-slate-200 hover:bg-slate-800">
                Always Low — <span className="font-mono text-slate-400">{addr}</span>
              </button>
            </>
          )}
          <p className="px-2 pt-1.5 pb-1 text-[9.5px] text-slate-600 leading-snug border-t border-slate-800 mt-1">
            A correction teaches the next triage; this email moves now.
          </p>
        </div>
      )}
    </span>
  );
}

export default function EmailCard(props: EmailCardProps) {
  const { email, selected, onToggle, onExpand, onMarkRead, onSetPriority, onKeep, onSenderRule, previousSeen = 0, compact = false, expanded = false, focused = false, showAccount = false, busy = false } = props;
  const cfg = PRIORITY_CONFIG[email.priority];
  const sender = parseSender(email.from);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [draft, setDraft] = useState<DraftState>({ phase: "idle" });
  const [convert, setConvert] = useState<ConvertState>({ phase: "idle" });
  // "File under Family": one tap applies a Gmail label (Family/School …) AND
  // tracks the sender in the Family roster, so the Family tab reads this
  // sender from now on with nothing typed.
  const [fileMenu, setFileMenu] = useState(false);
  const [filed, setFiled] = useState<{ label: string; tracked: boolean } | "busy" | null>(null);
  const menuRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!fileMenu) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setFileMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFileMenu(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [fileMenu]);

  const fileUnderFamily = async (category: string, labelName: string) => {
    setFileMenu(false);
    setFiled("busy");
    try {
      const res = await fetch("/api/gmail/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [email.id], account: email.account, category, senders: [email.from] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d?.error || "Could not file it");
      const tracked = Array.isArray(d.tracked) && d.tracked.some((t: { added?: boolean }) => t.added);
      setFiled({ label: d.label ?? labelName, tracked });
      toast.ok(`Filed under ${d.label ?? labelName}`, tracked ? `${sender.email.split("@")[1] ?? "sender"} now tracked by the Family tab` : "sender already tracked, or a personal address");
    } catch (e) {
      setFiled(null);
      toast.error("Could not file that email", e);
    }
  };

  // Convert this email → a Google Task or Calendar event. Claude pre-fills from
  // the email; the user reviews/edits inline before it's created.
  const startConvert = async (kind: "task" | "event") => {
    if (convert.phase === "loading" || convert.phase === "saving") return;
    setConvert({ phase: "loading", kind });
    try {
      const res = await fetch("/api/gmail/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: email.id, account: email.account, kind, mode: "plan" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.plan) { setConvert({ phase: "error", message: d?.error || "Conversion failed" }); return; }
      if (kind === "task") setConvert({ phase: "review", kind: "task", plan: { title: String(d.plan.title ?? ""), due: d.plan.due, notes: d.plan.notes } });
      else setConvert({ phase: "review", kind: "event", plan: { summary: String(d.plan.summary ?? ""), start: String(d.plan.start ?? ""), end: String(d.plan.end ?? ""), location: d.plan.location } });
    } catch {
      setConvert({ phase: "error", message: "Network error" });
    }
  };

  const saveConvert = async () => {
    if (convert.phase !== "review") return;
    const { kind, plan } = convert;
    setConvert({ phase: "saving" });
    try {
      const res = await fetch("/api/gmail/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: email.id, account: email.account, kind, mode: "create", plan }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { setConvert({ phase: "error", message: d?.error || "Couldn't create it" }); return; }
      setConvert({ phase: "saved", what: kind === "task" ? "task" : "calendar event" });
    } catch {
      setConvert({ phase: "error", message: "Network error" });
    }
  };
  const toLocalInput = (iso: string) => iso.slice(0, 16);
  const fromLocalInput = (v: string) => (v.length === 16 ? `${v}:00` : v);

  // Smart drafted reply: generate → review/edit inline → save as a Gmail
  // DRAFT (never sends; the human sends from Gmail).
  const generateDraft = async () => {
    if (draft.phase === "loading" || draft.phase === "saving") return;
    setDraft({ phase: "loading" });
    try {
      const res = await fetch("/api/gmail/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: email.id, account: email.account, mode: "generate" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.draft) { setDraft({ phase: "error", message: d?.error || "Draft failed" }); return; }
      setDraft({ phase: "review", text: String(d.draft) });
    } catch {
      setDraft({ phase: "error", message: "Network error" });
    }
  };

  const saveDraftToGmail = async () => {
    if (draft.phase !== "review") return;
    const text = draft.text;
    setDraft({ phase: "saving", text });
    try {
      const res = await fetch("/api/gmail/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: email.id, account: email.account, mode: "create", draftBody: text }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { setDraft({ phase: "error", message: d?.error || "Save failed" }); return; }
      setDraft({ phase: "saved" });
    } catch {
      setDraft({ phase: "error", message: "Network error" });
    }
  };

  const saveToDocs = async () => {
    if (saveState === "saving" || saveState === "saved") return;
    setSaveState("saving");
    try {
      const body = (email.bodyPreview || email.snippet || "").trim();
      const blockquote = body ? `> ${body.replace(/\n/g, "\n> ")}\n\n` : "";
      const content =
        `# ${email.subject || "(no subject)"}\n\n` +
        `**From:** ${email.from}  ·  **Account:** ${email.accountEmail}  ·  **Date:** ${email.date.slice(0, 10)}\n\n` +
        (email.summary ? `**AI summary:** ${email.summary}\n\n` : "") +
        blockquote +
        `---\n\n## Notes\n\n_(your notes here)_\n`;
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Email: ${email.subject || "(no subject)"}`.slice(0, 240), content, tags: ["email"], link: { type: "email", id: email.id, title: email.subject } }),
      });
      if (!res.ok) throw new Error();
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1800);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 1800);
    }
  };

  const timeAgo = (() => {
    try { return formatDistanceToNow(parseISO(email.date), { addSuffix: true }); }
    catch { return ""; }
  })();
  const isStale = (() => {
    if (!previousSeen) return false;
    try { return parseISO(email.date).getTime() < previousSeen; } catch { return false; }
  })();
  const kept = !!email.keep;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const accountDot = showAccount && email.account === "secondary" ? (
    <span title={email.accountEmail} className="w-2 h-2 rounded-full bg-violet-400 flex-shrink-0" aria-label={`from ${email.accountEmail}`} />
  ) : null;

  const checkbox = (
    <input
      type="checkbox"
      checked={selected}
      onChange={() => onToggle(email.id)}
      onClick={stop}
      aria-label="Select email"
      className="h-4 w-4 rounded border-slate-700 bg-slate-800 flex-shrink-0 accent-emerald-500 cursor-pointer"
    />
  );

  const readButton = (small?: boolean) => (
    <button
      type="button"
      onClick={(e) => { stop(e); if (!kept) onMarkRead(email); }}
      disabled={busy || kept}
      title={kept ? "Kept — unkeep to mark read" : "Mark read"}
      className={small
        ? `w-6 h-6 flex items-center justify-center rounded-md text-xs font-bold transition-all ${kept ? "text-slate-700 cursor-not-allowed" : "text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/15"}`
        : `${ACT} ${kept ? "border-slate-800 text-slate-600 cursor-not-allowed" : "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15"}`}
    >
      {small ? "✓" : "✓ Read"}
    </button>
  );

  // ---- COMPACT (closed) -------------------------------------------------------
  if (compact && !expanded) {
    return (
      <div
        className={`relative grid grid-cols-[16px_minmax(0,150px)_1fr_auto] items-center gap-3 pl-4 pr-3 py-1.5 border-t border-slate-800/70 cursor-pointer transition-colors ${
          selected ? "bg-emerald-500/5" : "hover:bg-slate-800/40"
        } ${isStale ? "opacity-60 hover:opacity-100" : ""} ${focused ? "ring-1 ring-inset ring-sky-500/60" : ""} ${kept ? "bg-violet-500/[0.04]" : ""}`}
        onClick={() => onExpand?.(email.id)}
        data-email-id={email.id}
      >
        <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${cfg.bar}`} />
        {checkbox}
        <span className="flex items-center gap-1.5 min-w-0">
          {accountDot}
          <span className="text-[12.5px] font-semibold text-slate-300 truncate">{sender.name}</span>
        </span>
        <span className="min-w-0 truncate text-[12.5px] text-slate-200">
          {kept && <span className="mr-1.5 text-[8.5px] font-bold uppercase tracking-wider text-violet-300 bg-violet-500/15 rounded px-1 py-px align-middle">⚑ kept</span>}
          {email.subject || "(no subject)"}
          {email.why && <span className="ml-2 text-[10.5px] text-slate-500"><span className="text-[8.5px] uppercase tracking-wider text-slate-600">why · </span>{email.why}</span>}
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          {timeAgo && <span className="text-[10px] text-slate-600 font-mono hidden sm:inline whitespace-nowrap">{timeAgo}</span>}
          <PriorityMenu email={email} busy={busy} onSetPriority={onSetPriority} onSenderRule={onSenderRule} small />
          {readButton(true)}
        </span>
      </div>
    );
  }

  // ---- FULL ------------------------------------------------------------------
  return (
    <div
      className={`relative flex gap-3 pl-4 pr-4 py-3 transition-colors ${compact ? "border-t border-slate-800/70" : "border-t border-slate-800/70 first:border-t-0"} ${
        selected ? "bg-emerald-500/5" : kept ? "bg-violet-500/[0.04]" : ""
      } ${isStale ? "opacity-60 hover:opacity-100" : ""} ${focused ? "ring-1 ring-inset ring-sky-500/60" : ""} ${fileMenu ? "z-20" : ""}`}
      data-email-id={email.id}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${cfg.bar}`} />
      <div className="pt-0.5">{checkbox}</div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {accountDot}
          <span className="text-sm font-semibold text-slate-200 truncate">{sender.name}</span>
          <PriorityMenu email={email} busy={busy} onSetPriority={onSetPriority} onSenderRule={onSenderRule} />
          {kept && <span className="text-[9px] font-bold uppercase tracking-wider text-violet-300 bg-violet-500/15 rounded px-1.5 py-px">⚑ kept</span>}
          <span className="ml-auto flex items-center gap-2">
            {timeAgo && <span className="text-[10px] text-slate-600 font-mono whitespace-nowrap">{timeAgo}</span>}
            {compact && onExpand && (
              <button type="button" onClick={() => onExpand(null)} title="Collapse" className="text-slate-600 hover:text-slate-300 text-xs">▴</button>
            )}
          </span>
        </div>

        <p className="text-sm font-medium text-slate-200 mt-1 break-words">
          {filed && filed !== "busy" && (
            <span className="inline-flex items-center gap-1 mr-1.5 align-middle text-[9px] font-bold uppercase tracking-wider text-rose-300 border border-rose-500/40 bg-rose-500/10 rounded px-1.5 py-px">
              {filed.label}{filed.tracked ? " · tracked" : ""}
            </span>
          )}
          {email.subject || "(no subject)"}
        </p>
        {email.why && (
          <p className="text-[10.5px] text-slate-500 mt-0.5">
            <span className="text-[8.5px] uppercase tracking-wider text-slate-600">why · </span>{email.why}
          </p>
        )}
        {(email.summary || email.snippet) && (
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">{email.summary || email.snippet}</p>
        )}

        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {readButton()}
          <button
            type="button"
            onClick={() => onKeep(email, !kept)}
            disabled={busy}
            title={kept ? "Kept — no bulk action marks this read. Click to unkeep." : "Keep — never marked read by a bulk action"}
            className={`${ACT} ${kept ? "border-violet-500/50 text-violet-200 bg-violet-500/15" : "border-slate-700/80 text-slate-400 hover:text-violet-200 hover:border-violet-500/50"}`}
          >
            {kept ? "⚑ Kept" : "⚑ Keep"}
          </button>
          <button
            type="button"
            onClick={generateDraft}
            disabled={draft.phase === "loading" || draft.phase === "saving"}
            title={draft.phase === "saved" ? "Draft saved to Gmail" : "Draft a reply in your voice (saved to Gmail Drafts — never sent)"}
            className={`${ACT_IDLE} ${draft.phase === "saved" ? "!text-emerald-400 !border-emerald-500/40" : draft.phase === "loading" ? "cursor-wait" : ""}`}
          >
            {draft.phase === "loading" ? "…" : "✎ Draft"}
          </button>
          <button type="button" onClick={() => startConvert("task")} disabled={convert.phase === "loading" || convert.phase === "saving"} title="Convert to a Google Task" className={ACT_IDLE}>
            {convert.phase === "loading" && convert.kind === "task" ? "…" : "＋ Task"}
          </button>
          <button type="button" onClick={() => startConvert("event")} disabled={convert.phase === "loading" || convert.phase === "saving"} title="Convert to a Calendar event" className={ACT_IDLE}>
            {convert.phase === "loading" && convert.kind === "event" ? "…" : "📅 Event"}
          </button>
          <span className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => { if (filed && filed !== "busy") return; setFileMenu((v) => !v); }}
              disabled={filed === "busy"}
              title={filed && filed !== "busy" ? `Filed under ${filed.label}` : "File under Family — labels it in Gmail and tracks the sender on the Family tab"}
              aria-haspopup="menu"
              aria-expanded={fileMenu}
              className={`${ACT} inline-flex items-center gap-1 ${filed && filed !== "busy" ? "border-rose-500/40 text-rose-300 bg-rose-500/10" : "border-slate-700/80 text-slate-400 hover:text-rose-300 hover:border-rose-500/50"}`}
            >
              <FamilyFileIcon size={11} strokeWidth={2.25} /> Family
            </button>
            {fileMenu && (
              <div role="menu" onClick={stop} className="absolute left-0 top-full mt-1 z-30 min-w-[230px] rounded-lg border border-slate-700 bg-slate-950 shadow-2xl p-1.5 normal-case tracking-normal">
                <p className="px-2 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-rose-300">File under Family</p>
                {FAMILY_LABELS.map((l) => (
                  <button key={l.category} role="menuitem" onClick={() => fileUnderFamily(l.category, l.name)} className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 flex items-baseline gap-2">
                    <span className="text-[11.5px] font-semibold text-slate-200">{l.name.replace("Family/", "")}</span>
                    <span className="text-[9.5px] text-slate-500 truncate">{l.hint}</span>
                  </button>
                ))}
                <p className="px-2 pt-1.5 pb-1 text-[9px] text-slate-600 leading-snug border-t border-slate-800 mt-1">
                  Applies the Gmail label and tracks <span className="font-mono text-slate-500">{sender.email.split("@")[1] ?? "the sender"}</span> in that roster bucket.
                </p>
              </div>
            )}
          </span>
          <button type="button" onClick={saveToDocs} disabled={saveState === "saving" || saveState === "saved"} title={saveState === "saved" ? "Saved to Docs" : saveState === "error" ? "Save failed — click to retry" : "Save excerpt to Docs"} className={`${ACT_IDLE} ${saveState === "saved" ? "!text-emerald-400 !border-emerald-500/40" : saveState === "error" ? "!text-red-400 !border-red-500/40" : ""}`}>
            {saveState === "saved" ? "✓ Doc" : saveState === "error" ? "! Doc" : "▤ Doc"}
          </button>
          <a href={gmailLink(email)} target="_blank" rel="noopener noreferrer" onClick={stop} className={`${ACT} border-transparent text-slate-500 hover:text-slate-300`}>open in Gmail ↗</a>
        </div>

        {/* Drafted-reply review panel — edit inline, then save to Gmail Drafts. */}
        {(draft.phase === "review" || draft.phase === "saving") && (
          <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/[0.05] p-2.5" onClick={stop}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] font-bold uppercase tracking-widest text-violet-300">✎ Drafted reply</span>
              <span className="text-[9px] font-mono text-slate-600">review & edit — saves to Gmail Drafts, never sends</span>
            </div>
            <textarea
              value={draft.text}
              onChange={(e) => setDraft({ phase: "review", text: e.target.value })}
              disabled={draft.phase === "saving"}
              rows={Math.min(12, Math.max(4, draft.text.split("\n").length + 1))}
              className="w-full bg-slate-950/60 border border-slate-800 rounded-md px-2.5 py-2 text-xs text-slate-200 leading-relaxed outline-none focus:border-violet-500/40 resize-y font-sans"
            />
            <div className="flex items-center gap-2 mt-1.5">
              <button onClick={saveDraftToGmail} disabled={draft.phase === "saving" || !draft.text.trim()} className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 transition-all">
                {draft.phase === "saving" ? "Saving…" : "Save to Gmail Drafts"}
              </button>
              <button onClick={generateDraft} disabled={draft.phase === "saving"} className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-40 transition-all">↻ Regenerate</button>
              <button onClick={() => setDraft({ phase: "idle" })} disabled={draft.phase === "saving"} className="ml-auto text-slate-600 hover:text-slate-300 text-xs">×</button>
            </div>
          </div>
        )}
        {draft.phase === "saved" && <p className="mt-2 text-[10px] font-mono text-emerald-400">✓ Saved to Gmail Drafts — open Gmail to review and send.</p>}
        {draft.phase === "error" && <p className="mt-2 text-[10px] font-mono text-red-400">✎ {draft.message} — <button onClick={generateDraft} className="underline hover:text-red-300">retry</button></p>}

        {/* Email → task/event review panel — edit the AI-extracted plan, then create. */}
        {convert.phase === "review" && (
          <div className={`mt-3 rounded-lg border p-2.5 ${convert.kind === "task" ? "border-emerald-500/30 bg-emerald-500/[0.05]" : "border-sky-500/30 bg-sky-500/[0.05]"}`} onClick={stop}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[9px] font-bold uppercase tracking-widest ${convert.kind === "task" ? "text-emerald-300" : "text-sky-300"}`}>{convert.kind === "task" ? "＋ New task" : "📅 New event"}</span>
              <span className="text-[9px] font-mono text-slate-600">review & edit — links back to this email</span>
            </div>
            {convert.kind === "task" ? (
              <div className="space-y-1.5">
                <input value={convert.plan.title} onChange={(e) => setConvert({ phase: "review", kind: "task", plan: { ...convert.plan, title: e.target.value } })} placeholder="Task" className="w-full bg-slate-950/60 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/40" />
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-mono text-slate-500">Due</label>
                  <input type="date" value={convert.plan.due ?? ""} onChange={(e) => setConvert({ phase: "review", kind: "task", plan: { ...convert.plan, due: e.target.value || undefined } })} className="bg-slate-950/60 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200 outline-none" />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <input value={convert.plan.summary} onChange={(e) => setConvert({ phase: "review", kind: "event", plan: { ...convert.plan, summary: e.target.value } })} placeholder="Event title" className="w-full bg-slate-950/60 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500/40" />
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-[10px] font-mono text-slate-500">Start</label>
                  <input type="datetime-local" value={toLocalInput(convert.plan.start)} onChange={(e) => setConvert({ phase: "review", kind: "event", plan: { ...convert.plan, start: fromLocalInput(e.target.value) } })} className="bg-slate-950/60 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200 outline-none" />
                  <label className="text-[10px] font-mono text-slate-500">End</label>
                  <input type="datetime-local" value={toLocalInput(convert.plan.end)} onChange={(e) => setConvert({ phase: "review", kind: "event", plan: { ...convert.plan, end: fromLocalInput(e.target.value) } })} className="bg-slate-950/60 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200 outline-none" />
                </div>
                <input value={convert.plan.location ?? ""} onChange={(e) => setConvert({ phase: "review", kind: "event", plan: { ...convert.plan, location: e.target.value || undefined } })} placeholder="Location (optional)" className="w-full bg-slate-950/60 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500/40" />
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <button onClick={saveConvert} className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-all ${convert.kind === "task" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20" : "border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"}`}>
                {convert.kind === "task" ? "Add task" : "Add to calendar"}
              </button>
              <button onClick={() => setConvert({ phase: "idle" })} className="ml-auto text-slate-600 hover:text-slate-300 text-xs">×</button>
            </div>
          </div>
        )}
        {convert.phase === "saving" && <p className="mt-2 text-[10px] font-mono text-slate-500">Creating…</p>}
        {convert.phase === "saved" && <p className="mt-2 text-[10px] font-mono text-emerald-400">✓ Added to your {convert.what}.</p>}
        {convert.phase === "error" && <p className="mt-2 text-[10px] font-mono text-red-400">⚠ {convert.message}</p>}
      </div>
    </div>
  );
}
