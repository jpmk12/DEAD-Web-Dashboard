import { EmailMessage, EmailPriority } from "@/lib/types";
import { formatDistanceToNow, parseISO } from "date-fns";
import { useState } from "react";

interface EmailCardProps {
  email: EmailMessage;
  selected: boolean;
  onToggle: (id: string) => void;
  previousSeen?: number;
}

const PRIORITY_CONFIG: Record<EmailPriority, { badge: string; bar: string; glow: string }> = {
  High: {
    badge: "bg-red-500/15 text-red-400 border border-red-500/40",
    bar: "bg-red-500",
    glow: "shadow-[2px_0_0_0_rgb(239_68_68)]",
  },
  Medium: {
    badge: "bg-amber-500/15 text-amber-400 border border-amber-500/40",
    bar: "bg-amber-500",
    glow: "shadow-[2px_0_0_0_rgb(245_158_11)]",
  },
  Low: {
    badge: "bg-slate-700/60 text-slate-500 border border-slate-700",
    bar: "bg-slate-700",
    glow: "",
  },
};

function parseSender(from: string) {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].replace(/"/g, "").trim(), email: match[2] };
  return { name: from, email: from };
}

type SaveState = "idle" | "saving" | "saved" | "error";
type DraftState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "review"; text: string }
  | { phase: "saving"; text: string }
  | { phase: "saved" }
  | { phase: "error"; message: string };

export default function EmailCard({ email, selected, onToggle, previousSeen = 0 }: EmailCardProps) {
  const cfg = PRIORITY_CONFIG[email.priority];
  const sender = parseSender(email.from);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [draft, setDraft] = useState<DraftState>({ phase: "idle" });

  // Smart drafted reply: generate → review/edit inline → save as a Gmail
  // DRAFT (never sends; the human sends from Gmail).
  const generateDraft = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  // Compose the saved-doc body. Mirrors the news save-to-Docs pattern: a
  // short header block, the body preview as a blockquote, and a `## Notes`
  // section the user can fill in. The original email message id is recorded
  // as an external link so the new doc shows up as a backlink anywhere we
  // surface the source email (e.g. backlink chips on a future per-email
  // detail view).
  const saveToDocs = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (saveState === "saving" || saveState === "saved") return;
    setSaveState("saving");
    try {
      const body = (email.bodyPreview || email.snippet || "").trim();
      const blockquote = body
        ? `> ${body.replace(/\n/g, "\n> ")}\n\n`
        : "";
      const content =
        `# ${email.subject || "(no subject)"}\n\n` +
        `**From:** ${email.from}  ·  **Account:** ${email.accountEmail}  ·  **Date:** ${email.date.slice(0, 10)}\n\n` +
        (email.summary ? `**AI summary:** ${email.summary}\n\n` : "") +
        blockquote +
        `---\n\n## Notes\n\n_(your notes here)_\n`;
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Email: ${email.subject || "(no subject)"}`.slice(0, 240),
          content,
          tags: ["email"],
          link: { type: "email", id: email.id, title: email.subject },
        }),
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

  return (
    <div
      className={`relative flex gap-3 pl-4 pr-4 py-3.5 rounded-xl border transition-all cursor-pointer card-hover ${
        selected
          ? "border-emerald-600/50 bg-emerald-500/5"
          : "border-slate-800 bg-slate-900 hover:border-slate-700"
      } ${isStale ? "opacity-50 hover:opacity-100" : ""}`}
      onClick={() => onToggle(email.id)}
    >
      {/* Priority left border */}
      <div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${cfg.bar}`} />

      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(email.id)}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-800 flex-shrink-0 accent-emerald-500"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-slate-200 truncate">{sender.name}</span>
            {email.accountEmail && (
              <span
                title={email.accountEmail}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md border max-w-[140px] truncate flex-shrink-0 ${
                  email.account === "secondary"
                    ? "bg-violet-500/10 text-violet-400 border-violet-500/30"
                    : "bg-slate-800 text-slate-500 border-slate-700"
                }`}
              >
                {email.accountEmail}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${cfg.badge}`}>
              {email.priority}
            </span>
            {timeAgo && (
              <span className="text-[10px] text-slate-600 font-mono hidden sm:inline">{timeAgo}</span>
            )}
            <button
              onClick={generateDraft}
              disabled={draft.phase === "loading" || draft.phase === "saving"}
              title={
                draft.phase === "saved" ? "Draft saved to Gmail" :
                "Draft a reply in your voice (saved to Gmail Drafts — never sent)"
              }
              className={`w-6 h-6 flex items-center justify-center rounded-md transition-all text-sm ${
                draft.phase === "saved" ? "text-emerald-400 bg-emerald-500/10"
                : draft.phase === "loading" ? "text-violet-300/70 cursor-wait"
                : "text-slate-600 hover:text-violet-300 hover:bg-violet-500/10"
              }`}
            >
              {draft.phase === "loading" ? "…" : "✎"}
            </button>
            <button
              onClick={saveToDocs}
              disabled={saveState === "saving" || saveState === "saved"}
              title={
                saveState === "saved" ? "Saved to Docs" :
                saveState === "error" ? "Save failed — click to retry" :
                "Save excerpt to Docs"
              }
              className={`w-6 h-6 flex items-center justify-center rounded-md transition-all text-sm ${
                saveState === "saved"
                  ? "text-emerald-400 bg-emerald-500/10"
                  : saveState === "error"
                  ? "text-red-400 bg-red-500/10"
                  : saveState === "saving"
                  ? "text-slate-500 cursor-wait"
                  : "text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10"
              }`}
            >
              {saveState === "saved" ? "✓" : saveState === "error" ? "!" : "▤"}
            </button>
          </div>
        </div>

        <p className="text-sm font-medium text-slate-300 truncate mb-1">{email.subject}</p>
        <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{email.summary || email.snippet}</p>

        {/* Drafted-reply review panel — edit inline, then save to Gmail Drafts. */}
        {(draft.phase === "review" || draft.phase === "saving") && (
          <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/[0.05] p-2.5" onClick={(e) => e.stopPropagation()}>
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
              <button
                onClick={saveDraftToGmail}
                disabled={draft.phase === "saving" || !draft.text.trim()}
                className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 transition-all"
              >
                {draft.phase === "saving" ? "Saving…" : "Save to Gmail Drafts"}
              </button>
              <button
                onClick={generateDraft}
                disabled={draft.phase === "saving"}
                className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-40 transition-all"
              >
                ↻ Regenerate
              </button>
              <button
                onClick={() => setDraft({ phase: "idle" })}
                disabled={draft.phase === "saving"}
                className="ml-auto text-slate-600 hover:text-slate-300 text-xs"
              >
                ×
              </button>
            </div>
          </div>
        )}
        {draft.phase === "saved" && (
          <p className="mt-2 text-[10px] font-mono text-emerald-400" onClick={(e) => e.stopPropagation()}>
            ✓ Saved to Gmail Drafts — open Gmail to review and send.
          </p>
        )}
        {draft.phase === "error" && (
          <p className="mt-2 text-[10px] font-mono text-red-400" onClick={(e) => e.stopPropagation()}>
            ✎ {draft.message} — <button onClick={generateDraft} className="underline hover:text-red-300">retry</button>
          </p>
        )}
      </div>
    </div>
  );
}
