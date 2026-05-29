import { EmailMessage, EmailPriority } from "@/lib/types";
import { formatDistanceToNow, parseISO } from "date-fns";

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

export default function EmailCard({ email, selected, onToggle, previousSeen = 0 }: EmailCardProps) {
  const cfg = PRIORITY_CONFIG[email.priority];
  const sender = parseSender(email.from);
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
          </div>
        </div>

        <p className="text-sm font-medium text-slate-300 truncate mb-1">{email.subject}</p>
        <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{email.summary || email.snippet}</p>
      </div>
    </div>
  );
}
