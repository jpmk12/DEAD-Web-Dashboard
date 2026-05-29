"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { EmailMessage, EmailPriority, ActionItem, VipSuggestion } from "@/lib/types";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import EmailCard from "./EmailCard";
import AddAccountButton from "./AddAccountButton";
import BulkActionBar from "./BulkActionBar";

const CACHE_KEY = "gmail:emails";

type Filter = "All" | EmailPriority;

function formatUpdated(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface EmailTabProps {
  previousSeen?: number;
}

export default function EmailTab({ previousSeen = 0 }: EmailTabProps) {
  const { status } = useSession();
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("All");
  const [markingRead, setMarkingRead] = useState(false);
  const [secondaryConnected, setSecondaryConnected] = useState(false);
  const [secondaryEmail, setSecondaryEmail] = useState<string | undefined>();
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [actionsChecked, setActionsChecked] = useState<Set<string>>(new Set());
  // key → "pending" while POST is in flight, "added" once Google Tasks accepted it
  const [taskStatus, setTaskStatus] = useState<Map<string, "pending" | "added" | "failed">>(new Map());
  const [docStatus, setDocStatus]   = useState<Map<string, "pending" | "added" | "failed">>(new Map());
  const [vipSuggestions, setVipSuggestions] = useState<VipSuggestion[]>([]);
  const [suggestionBusy, setSuggestionBusy] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchEmails = async (forceRefresh = false) => {
    const stale = clientCache.peek<EmailMessage[]>(CACHE_KEY);
    const isFresh = clientCache.isFresh(CACHE_KEY);

    if (stale) setEmails(stale);
    if (isFresh && !forceRefresh) return;

    const showSpinner = !stale || forceRefresh;
    if (showSpinner) { setLoading(true); setError(null); }

    try {
      const res = await fetch("/api/gmail");
      if (res.status === 401) {
        const data = await res.json();
        if (data.error === "reauth_required") {
          setError("Your session needs to be refreshed. Please sign out and sign back in.");
        }
        return;
      }
      const data = await res.json();
      const emailList: EmailMessage[] = data.emails ?? [];
      setEmails(emailList);
      setSecondaryConnected(data.secondaryConnected ?? false);
      setLastUpdated(new Date());
      clientCache.set(CACHE_KEY, emailList, CACHE_TTL.EMAIL);

      // Actions extraction is in its own effect below, gated on the email-id
      // set actually changing. Don't re-fire on every fetchEmails() call.
    } catch {
      setError("Failed to load emails. Please try again.");
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  const fetchSecondaryStatus = async () => {
    try {
      const res = await fetch("/api/auth/gmail-secondary?step=status");
      const data = await res.json();
      setSecondaryConnected(data.connected);
      setSecondaryEmail(data.email);
    } catch { /* ignore — secondary status is best-effort */ }
  };

  useEffect(() => {
    if (status === "authenticated") {
      fetchEmails();
      fetchSecondaryStatus();
      // Best-effort VIP suggestion fetch. Cached server-side at 12h so this
      // is cheap after the first call of the day.
      fetch("/api/gmail/vip-suggestions")
        .then((r) => r.json())
        .then((d: { suggestions?: VipSuggestion[] }) => setVipSuggestions(d.suggestions ?? []))
        .catch(() => {});
    }
  }, [status]);

  // Stable hash of the unread email-id set. Lets us re-fire the action-item
  // extraction only when the set genuinely changes — tab switches and
  // re-renders no longer pay for a redundant Claude call.
  const emailIdsKey = useMemo(
    () => emails.map((e) => e.id).sort().join("|"),
    [emails]
  );
  const lastActionsKey = useRef<string>("");

  useEffect(() => {
    if (emails.length === 0) return;
    if (emailIdsKey === lastActionsKey.current) return;
    lastActionsKey.current = emailIdsKey;
    setActionsLoading(true);
    fetch("/api/gmail/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails }),
    })
      .then((r) => r.json())
      .then((d) => setActions(d.actions ?? []))
      .catch(() => {})
      .finally(() => setActionsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailIdsKey]);

  // Atomic single-field append via the dedicated endpoint — avoids the
  // GET → mutate → POST clobber risk with concurrent prefs edits.
  const updatePrefsField = async (
    field: "vipSenders" | "dismissedVipSuggestions",
    add: string
  ) => {
    try {
      const res = await fetch("/api/user-prefs/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value: add }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const acceptSuggestion = async (s: VipSuggestion) => {
    if (suggestionBusy.has(s.email)) return;
    setSuggestionBusy((prev) => new Set(prev).add(s.email));
    const ok = await updatePrefsField("vipSenders", s.email);
    setSuggestionBusy((prev) => { const n = new Set(prev); n.delete(s.email); return n; });
    if (ok) setVipSuggestions((prev) => prev.filter((x) => x.email !== s.email));
  };

  const dismissSuggestion = async (s: VipSuggestion) => {
    if (suggestionBusy.has(s.email)) return;
    setSuggestionBusy((prev) => new Set(prev).add(s.email));
    const ok = await updatePrefsField("dismissedVipSuggestions", s.email);
    setSuggestionBusy((prev) => { const n = new Set(prev); n.delete(s.email); return n; });
    if (ok) setVipSuggestions((prev) => prev.filter((x) => x.email !== s.email));
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const markEmailsRead = async (targets: EmailMessage[]) => {
    if (!targets.length) return;
    setMarkingRead(true);
    const targetIds = new Set(targets.map((e) => e.id));
    const byAccount = {
      primary: targets.filter((e) => e.account === "primary").map((e) => e.id),
      secondary: targets.filter((e) => e.account === "secondary").map((e) => e.id),
    };
    try {
      await Promise.all(
        (["primary", "secondary"] as const)
          .filter((acct) => byAccount[acct].length > 0)
          .map((account) =>
            fetch("/api/gmail/mark-read", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: byAccount[account], account }),
            })
          )
      );
      setEmails((prev) => {
        const updated = prev.filter((e) => !targetIds.has(e.id));
        clientCache.set(CACHE_KEY, updated, CACHE_TTL.EMAIL);
        return updated;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });
    } catch {
      setError("Failed to mark emails as read.");
    } finally {
      setMarkingRead(false);
    }
  };

  const handleMarkRead = () => markEmailsRead(emails.filter((e) => selected.has(e.id)));
  const handleMarkAllVisibleRead = () => markEmailsRead(visible);

  const addActionToTasks = async (key: string, action: ActionItem) => {
    if (taskStatus.get(key) === "added" || taskStatus.get(key) === "pending") return;
    setTaskStatus((prev) => new Map(prev).set(key, "pending"));
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: action.action,
          due: action.dueDate || undefined,
          notes: `From: ${action.from}\nRe: ${action.subject}`,
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setTaskStatus((prev) => new Map(prev).set(key, "added"));
      // Also mark the row's checkbox so the count decrements as a visual cue.
      setActionsChecked((prev) => new Set(prev).add(key));
    } catch {
      setTaskStatus((prev) => new Map(prev).set(key, "failed"));
    }
  };

  // Promote an action item to a tracking doc. Heavier-weight than the
  // single-shot Google Task — the doc carries Status / Notes / Subtasks
  // sections with interactive task-list markers so the user can break the
  // ask down. The source email is recorded as a backlink so the doc
  // surfaces wherever we list backlinks for that email.
  const addActionToDocs = async (key: string, action: ActionItem) => {
    if (docStatus.get(key) === "added" || docStatus.get(key) === "pending") return;
    setDocStatus((prev) => new Map(prev).set(key, "pending"));
    try {
      const dueLine = action.dueDate ? `**Due:** ${action.dueDate}\n\n` : "";
      const content =
        `# ${action.action}\n\n` +
        `**From:** ${action.from}  ·  **Re:** ${action.subject}\n\n` +
        dueLine +
        `---\n\n` +
        `## Status\n\n` +
        `- [ ] Open\n` +
        `- [ ] In progress\n` +
        `- [ ] Done\n\n` +
        `## Subtasks\n\n` +
        `- [ ] _(break the ask down here)_\n\n` +
        `## Notes\n\n` +
        `_(working notes, decisions, references)_\n`;
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Track: ${action.action}`.slice(0, 240),
          content,
          tags: ["tracking", "action-item"],
          link: { type: "email", id: action.emailId, title: action.subject },
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setDocStatus((prev) => new Map(prev).set(key, "added"));
    } catch {
      setDocStatus((prev) => new Map(prev).set(key, "failed"));
    }
  };

  const filters: Filter[] = ["All", "High", "Medium", "Low"];
  const visible = filter === "All" ? emails : emails.filter((e) => e.priority === filter);

  const allVisibleSelected = visible.length > 0 && visible.every((e) => selected.has(e.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected((prev) => { const next = new Set(prev); visible.forEach((e) => next.delete(e.id)); return next; });
    } else {
      setSelected((prev) => { const next = new Set(prev); visible.forEach((e) => next.add(e.id)); return next; });
    }
  };

  if (status === "unauthenticated") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 text-center">
        <div className="text-4xl">✉️</div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Connect Your Gmail</h2>
        <p className="text-sm text-slate-500 max-w-xs">
          Sign in with Google to view and triage your emails with AI-powered summaries.
        </p>
        <button
          onClick={() => signIn("google")}
          className="flex items-center gap-2 bg-slate-800 border border-slate-700 text-slate-200 px-5 py-2.5 rounded-lg font-medium hover:border-green-700 hover:text-green-400 transition-all text-sm"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="pb-20">
      {/* VIP suggestions — surfaced when the user has replied to someone 3+
          times in 30 days and hasn't already classified them. */}
      {vipSuggestions.length > 0 && (
        <div className="mb-6 bg-emerald-500/5 rounded-xl border border-emerald-500/30 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-emerald-500/20">
            <div className="w-6 h-6 rounded-md bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
              <span className="text-emerald-400 text-xs">★</span>
            </div>
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
              Suggested VIPs
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              · senders you reply to often
            </span>
          </div>
          <ul className="divide-y divide-emerald-500/10">
            {vipSuggestions.map((s) => {
              const busy = suggestionBusy.has(s.email);
              const lastDate = s.lastReplyAt ? new Date(s.lastReplyAt) : null;
              const lastFmt = lastDate && !isNaN(lastDate.getTime())
                ? lastDate.toLocaleDateString([], { month: "short", day: "numeric" })
                : "";
              return (
                <li key={s.email} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-100 truncate">{s.email}</p>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {s.count} replies in 30 days{lastFmt ? ` · last on ${lastFmt}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => acceptSuggestion(s)}
                    disabled={busy}
                    className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 hover:text-emerald-200 px-2.5 py-1 rounded-md transition-all disabled:opacity-40"
                  >
                    {busy ? "…" : "Add VIP"}
                  </button>
                  <button
                    onClick={() => dismissSuggestion(s)}
                    disabled={busy}
                    title="Don't suggest again"
                    className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider bg-slate-800/80 hover:bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-md transition-all disabled:opacity-40"
                  >
                    Dismiss
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Action items checklist */}
      {(actionsLoading || actions.length > 0) && (
        <div className="mb-6 bg-amber-500/5 rounded-xl border border-amber-500/30 overflow-hidden glow-amber">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-amber-500/20">
            <div className="w-6 h-6 rounded-md bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <span className="text-amber-400 text-xs">⚡</span>
            </div>
            <span className="text-xs font-bold uppercase tracking-widest text-amber-400">Action Items</span>
            {actionsLoading && (
              <span className="text-[10px] text-slate-600 font-mono ml-auto animate-pulse uppercase tracking-wider">
                Extracting…
              </span>
            )}
            {!actionsLoading && actions.length > 0 && (
              <span className="ml-auto text-[10px] text-amber-600 font-mono">
                {actions.length - actionsChecked.size} remaining
              </span>
            )}
          </div>
          {actionsLoading && (
            <div className="px-4 py-3 space-y-2.5">
              {[1, 2].map((i) => (
                <div key={i} className="h-9 bg-slate-800/60 rounded-lg animate-pulse" />
              ))}
            </div>
          )}
          {!actionsLoading && actions.length > 0 && (
            <ul className="divide-y divide-amber-500/10">
              {actions.map((action, i) => {
                const key = `${action.emailId}-${i}`;
                const checked = actionsChecked.has(key);
                const status = taskStatus.get(key);
                const dstatus = docStatus.get(key);
                return (
                  <li
                    key={key}
                    className={`flex items-start gap-3 px-4 py-3 transition-all ${checked ? "opacity-40" : "hover:bg-amber-500/5"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setActionsChecked((prev) => {
                          const next = new Set(prev);
                          checked ? next.delete(key) : next.add(key);
                          return next;
                        });
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-amber-700/50 bg-slate-800 accent-amber-500 flex-shrink-0 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm text-slate-100 ${checked ? "line-through" : ""}`}>{action.action}</p>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                        {action.from} · {action.subject}
                        {action.dueDate && <span className="text-amber-500 ml-2 font-bold">{action.dueDate}</span>}
                      </p>
                    </div>
                    <div className="flex-shrink-0 self-center flex items-center gap-1.5">
                      <button
                        onClick={() => addActionToDocs(key, action)}
                        disabled={dstatus === "pending" || dstatus === "added"}
                        title={
                          dstatus === "added"
                            ? "Tracking doc created"
                            : dstatus === "failed"
                            ? "Failed — click to retry"
                            : "Promote to a tracking doc with Status / Subtasks / Notes sections"
                        }
                        className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border transition-all ${
                          dstatus === "added"
                            ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 cursor-default"
                            : dstatus === "pending"
                            ? "bg-slate-800 border-slate-700 text-slate-500 cursor-wait"
                            : dstatus === "failed"
                            ? "bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20"
                            : "bg-slate-800/80 border-slate-700 text-slate-400 hover:border-emerald-500/50 hover:text-emerald-300"
                        }`}
                      >
                        {dstatus === "added" ? "✓ Doc" : dstatus === "pending" ? "…" : dstatus === "failed" ? "Retry" : "▤ Doc"}
                      </button>
                      <button
                        onClick={() => addActionToTasks(key, action)}
                        disabled={status === "pending" || status === "added"}
                        title={
                          status === "added"
                            ? "Added to Google Tasks"
                            : status === "failed"
                            ? "Failed — click to retry"
                            : "Add to Google Tasks"
                        }
                        className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border transition-all ${
                          status === "added"
                            ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 cursor-default"
                            : status === "pending"
                            ? "bg-slate-800 border-slate-700 text-slate-500 cursor-wait"
                            : status === "failed"
                            ? "bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20"
                            : "bg-slate-800/80 border-slate-700 text-slate-400 hover:border-amber-500/50 hover:text-amber-300"
                        }`}
                      >
                        {status === "added" ? "✓ Task" : status === "pending" ? "…" : status === "failed" ? "Retry" : "+ Task"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-500 text-xs">◎</span>
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">Inbox</h2>
          </div>
          {!loading && (
            <p className="text-xs text-slate-600 font-mono mt-0.5">
              {emails.length} unread email{emails.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <AddAccountButton
            connected={secondaryConnected}
            secondaryEmail={secondaryEmail}
            onRevoked={() => { setSecondaryConnected(false); setSecondaryEmail(undefined); fetchEmails(true); }}
          />
          {lastUpdated && !loading && (
            <span className="text-[10px] text-slate-700 font-mono">{formatUpdated(lastUpdated)}</span>
          )}
          <button
            onClick={() => fetchEmails(true)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-400 disabled:opacity-40 font-mono transition-colors"
          >
            <span className={`text-base leading-none ${loading ? "animate-spin" : ""}`}>↻</span>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Priority filter pills */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all ${
              filter === f
                ? f === "High"
                  ? "bg-red-500/15 border border-red-500/40 text-red-400"
                  : f === "Medium"
                  ? "bg-amber-500/15 border border-amber-500/40 text-amber-400"
                  : "bg-emerald-500/15 border border-emerald-500/40 text-emerald-400"
                : "bg-slate-800/80 border border-slate-700/80 text-slate-500 hover:border-slate-600 hover:text-slate-300"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 bg-slate-900 rounded-xl border border-slate-800 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="flex items-center justify-between mb-2.5 px-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-slate-700 bg-slate-800 accent-emerald-500"
            />
            <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">
              {allVisibleSelected ? "Deselect all" : `Select all ${visible.length}`}
            </span>
          </label>
          <button
            onClick={handleMarkAllVisibleRead}
            disabled={markingRead}
            className="text-[11px] font-bold text-emerald-500 hover:text-emerald-400 disabled:opacity-40 uppercase tracking-wider transition-colors"
          >
            {markingRead ? "Marking…" : `Mark all ${filter === "All" ? "" : filter + " "}read`}
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-2">
          {visible.length === 0 ? (
            <div className="text-center py-16 text-slate-600 text-sm font-mono uppercase tracking-wider">
              {emails.length === 0 ? "Inbox clear — no unread emails" : "No emails match this filter"}
            </div>
          ) : (
            visible.map((email) => (
              <EmailCard
                key={email.id}
                email={email}
                selected={selected.has(email.id)}
                onToggle={toggleSelect}
                previousSeen={previousSeen}
              />
            ))
          )}
        </div>
      )}

      <BulkActionBar
        count={selected.size}
        onMarkRead={handleMarkRead}
        onClear={() => setSelected(new Set())}
        loading={markingRead}
      />
    </div>
  );
}
