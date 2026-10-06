"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { EmailMessage, EmailPriority, ActionItem, VipSuggestion } from "@/lib/types";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import { Mail } from "@/lib/icons";
import { toast } from "@/lib/feedback";
import { UI_KEYS, fetchUiState, patchUiState } from "@/lib/clientUiState";
import { actionKey, senderAddress, whyLine, type SenderRule, type WhySource } from "@/lib/emailLearning";
import EmailCard from "./EmailCard";
import AddAccountButton from "./AddAccountButton";
import BulkActionBar from "./BulkActionBar";

// The Email tab (REVIEW-2026-10 §4, E1–E7). The job is the SIFT: action
// items → Low (verify, clear) → Medium → High. So the list is always
// grouped High → Medium → Low, each group with its own "Mark N read"; Low
// rows are compact; the badge is a menu (promote / demote / sender rule);
// Keep protects an email from every bulk action, client AND server; a
// "How priority is decided" strip shows the rules and what corrections
// have taught; action items remember their state across devices.

const CACHE_KEY = "gmail:emails";

type Filter = "All" | EmailPriority | "Kept";
const GROUPS: EmailPriority[] = ["High", "Medium", "Low"];

interface RulesInfo {
  role: string;
  priorityTopics: number;
  deprioritizeTopics: number;
  watchlist: number;
  vip: number;
  muted: number;
  corrections: { total: number; promoted: number; demoted: number };
  suggestions: SenderRule[];
  rules: string[];
}

function formatUpdated(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const GROUP_STYLE: Record<EmailPriority, { label: string; chip: string; chipOn: string }> = {
  High: { label: "text-red-300", chip: "border-red-500/30 text-red-300/80 hover:border-red-500/60", chipOn: "bg-red-500/15 border-red-500/50 text-red-300" },
  Medium: { label: "text-amber-300", chip: "border-amber-500/30 text-amber-300/80 hover:border-amber-500/60", chipOn: "bg-amber-500/15 border-amber-500/50 text-amber-300" },
  Low: { label: "text-slate-300", chip: "border-slate-700 text-slate-400 hover:border-slate-500", chipOn: "bg-slate-700/50 border-slate-500 text-slate-200" },
};

interface EmailTabProps {
  previousSeen?: number;
  onPriorityCount?: (n: number) => void;
}

export default function EmailTab({ previousSeen = 0, onPriorityCount }: EmailTabProps) {
  const { status, data: session } = useSession();
  const primaryEmail = session?.user?.email ?? undefined;
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [secondaryNotice, setSecondaryNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("All");
  const [markingRead, setMarkingRead] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [secondaryConnected, setSecondaryConnected] = useState(false);
  const [secondaryEmail, setSecondaryEmail] = useState<string | undefined>();
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  // Persisted across devices (E6): ticked action keys and what went to Tasks / a Doc.
  const [actionsDone, setActionsDone] = useState<Set<string>>(new Set());
  const [actionsAdded, setActionsAdded] = useState<Record<string, "task" | "doc">>({});
  const [taskStatus, setTaskStatus] = useState<Map<string, "pending" | "failed">>(new Map());
  const [docStatus, setDocStatus] = useState<Map<string, "pending" | "failed">>(new Map());
  const [vipSuggestions, setVipSuggestions] = useState<VipSuggestion[]>([]);
  const [suggestionBusy, setSuggestionBusy] = useState<Set<string>>(new Set());
  const [rules, setRules] = useState<RulesInfo | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const publish = (list: EmailMessage[]) => clientCache.set(CACHE_KEY, list, CACHE_TTL.EMAIL);

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
        if (data.error === "reauth_required") setError("Your session needs to be refreshed. Please sign out and sign back in.");
        return;
      }
      const data = await res.json();
      const emailList: EmailMessage[] = data.emails ?? [];
      setEmails(emailList);
      setSecondaryConnected(data.secondaryConnected ?? false);
      setLastUpdated(new Date());
      publish(emailList);
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
    } catch { /* best-effort */ }
  };

  const fetchRules = useCallback(() => {
    fetch("/api/gmail/rules").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && typeof d === "object") setRules(d as RulesInfo); }).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const outcome = url.searchParams.get("secondary");
      if (!outcome) return;
      if (outcome === "same") setSecondaryNotice("That account is already your primary sign-in, so it was not added as a second Gmail. Tap “Add second Gmail” again and pick the OTHER account in Google’s chooser.");
      else if (outcome === "added") setSecondaryNotice("Second Gmail connected. Both accounts are read together; your primary sign-in is unchanged.");
      url.searchParams.delete("secondary");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch { /* cosmetic */ }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetchEmails();
    fetchSecondaryStatus();
    fetchRules();
    fetch("/api/gmail/vip-suggestions").then((r) => r.json()).then((d: { suggestions?: VipSuggestion[] }) => setVipSuggestions(d.suggestions ?? [])).catch(() => {});
    fetchUiState().then((st) => {
      const done = st[UI_KEYS.emailActionsDone];
      if (Array.isArray(done)) setActionsDone(new Set(done.filter((x): x is string => typeof x === "string")));
      const added = st[UI_KEYS.emailActionsAdded];
      if (added && typeof added === "object" && !Array.isArray(added)) {
        const out: Record<string, "task" | "doc"> = {};
        for (const [k, v] of Object.entries(added as Record<string, unknown>)) if (v === "task" || v === "doc") out[k] = v;
        setActionsAdded(out);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    onPriorityCount?.(emails.filter((e) => e.priority === "High").length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emails]);

  // ---- action items (per-message cached server-side; a shrink prunes locally) ----
  const emailIdsKey = useMemo(() => emails.map((e) => e.id).sort().join("|"), [emails]);
  const lastActionsKey = useRef<string>("");
  const lastExtractedIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (emails.length === 0) return;
    if (emailIdsKey === lastActionsKey.current) return;
    const ids = new Set(emails.map((e) => e.id));
    const isSubset = lastExtractedIds.current.size > 0 && [...ids].every((id) => lastExtractedIds.current.has(id));
    lastActionsKey.current = emailIdsKey;
    if (isSubset) {
      lastExtractedIds.current = ids;
      setActions((prev) => prev.filter((a) => ids.has(a.emailId)));
      return;
    }
    lastExtractedIds.current = ids;
    setActionsLoading(true);
    fetch("/api/gmail/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emails }) })
      .then((r) => r.json())
      .then((d) => setActions(Array.isArray(d.actions) ? d.actions : []))
      .catch(() => {})
      .finally(() => setActionsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailIdsKey]);

  const persistActionsDone = (next: Set<string>) => patchUiState({ [UI_KEYS.emailActionsDone]: [...next].slice(-300) });
  const toggleActionDone = (key: string) => {
    setActionsDone((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); persistActionsDone(n); return n; });
  };
  const markAdded = (key: string, what: "task" | "doc") => {
    setActionsAdded((prev) => {
      const next = { ...prev, [key]: what };
      const keys = Object.keys(next);
      const trimmed = keys.length > 300 ? Object.fromEntries(keys.slice(-300).map((k) => [k, next[k]])) : next;
      patchUiState({ [UI_KEYS.emailActionsAdded]: trimmed });
      return trimmed;
    });
    setActionsDone((prev) => { const n = new Set(prev).add(key); persistActionsDone(n); return n; });
  };

  // ---- prefs appends (VIP / mute / dismissals) ----
  const appendPref = async (field: "vipSenders" | "muteSenders" | "dismissedVipSuggestions", value: string) => {
    try {
      const res = await fetch("/api/user-prefs/append", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field, value }) });
      return res.ok;
    } catch { return false; }
  };

  const acceptSuggestion = async (s: VipSuggestion) => {
    if (suggestionBusy.has(s.email)) return;
    setSuggestionBusy((prev) => new Set(prev).add(s.email));
    const ok = await appendPref("vipSenders", s.email);
    setSuggestionBusy((prev) => { const n = new Set(prev); n.delete(s.email); return n; });
    if (ok) { setVipSuggestions((prev) => prev.filter((x) => x.email !== s.email)); applySenderRuleLocally(s.email, "high"); fetchRules(); }
  };
  const dismissSuggestion = async (s: VipSuggestion) => {
    if (suggestionBusy.has(s.email)) return;
    setSuggestionBusy((prev) => new Set(prev).add(s.email));
    const ok = await appendPref("dismissedVipSuggestions", s.email);
    setSuggestionBusy((prev) => { const n = new Set(prev); n.delete(s.email); return n; });
    if (ok) setVipSuggestions((prev) => prev.filter((x) => x.email !== s.email));
  };
  const acceptRule = async (r: SenderRule) => {
    if (suggestionBusy.has(r.key)) return;
    setSuggestionBusy((prev) => new Set(prev).add(r.key));
    const ok = await appendPref(r.kind === "high" ? "vipSenders" : "muteSenders", r.sender);
    setSuggestionBusy((prev) => { const n = new Set(prev); n.delete(r.key); return n; });
    if (ok) { applySenderRuleLocally(r.sender, r.kind); toast.ok(`${r.sender} is now Always ${r.kind === "high" ? "High" : "Low"}`); fetchRules(); }
    else toast.error("Could not save that rule");
  };
  const dismissRule = async (r: SenderRule) => {
    if (suggestionBusy.has(r.key)) return;
    setSuggestionBusy((prev) => new Set(prev).add(r.key));
    const ok = await appendPref("dismissedVipSuggestions", r.key);
    setSuggestionBusy((prev) => { const n = new Set(prev); n.delete(r.key); return n; });
    if (ok) setRules((prev) => (prev ? { ...prev, suggestions: prev.suggestions.filter((x) => x.key !== r.key) } : prev));
  };

  /** Re-derive the priority of every email from a sender that just got a rule (an override still wins). */
  const applySenderRuleLocally = (rule: string, kind: "high" | "low") => {
    const norm = rule.trim().toLowerCase().replace(/^@/, "");
    const matches = (from: string) => {
      const addr = senderAddress(from);
      if (!addr) return false;
      if (norm.includes("@")) return addr === norm;
      const domain = addr.slice(addr.lastIndexOf("@") + 1);
      return domain === norm || domain.endsWith("." + norm);
    };
    setEmails((prev) => {
      const next = prev.map((e) => {
        if (!matches(e.from)) return e;
        const priorityModel: EmailPriority = kind === "high" ? "High" : "Low";
        const source: WhySource = e.prioritySet ? "you" : kind === "high" ? "vip" : "mute";
        const priority = e.prioritySet ?? priorityModel;
        return { ...e, priority, priorityModel, whySource: source, why: whyLine({ source, prioritySet: e.prioritySet, priorityModel, modelWhy: modelWhyOf(e) }) };
      });
      publish(next);
      return next;
    });
  };
  /** The model's own clause, recovered from a composed why line. */
  const modelWhyOf = (e: EmailMessage): string | undefined => {
    const w = e.why ?? "";
    if (e.whySource === "model") return w;
    const i = w.indexOf(" · ");
    return i >= 0 ? w.slice(i + 3) : undefined;
  };

  // ---- per-email calls (E1 / E2) ----
  const setBusy = (id: string, on: boolean) => setBusyIds((prev) => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });
  const postPref = (email: EmailMessage, patch: { priority?: EmailPriority | null; keep?: boolean }) =>
    fetch("/api/gmail/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: email.id, accountEmail: email.accountEmail, priorityModel: email.priorityModel ?? email.priority, from: email.from, subject: email.subject, ...patch }) });

  const setPriority = async (email: EmailMessage, p: EmailPriority | null) => {
    const before = emails;
    const priorityModel = email.priorityModel ?? email.priority;
    const next = emails.map((e) => {
      if (e.id !== email.id) return e;
      const baseSource: WhySource = e.whySource === "vip" || e.whySource === "mute" ? e.whySource : e.whySource === "none" ? "none" : "model";
      return p
        ? { ...e, priority: p, prioritySet: p, priorityModel, whySource: "you" as const, why: whyLine({ source: "you", prioritySet: p, priorityModel, modelWhy: modelWhyOf(e) }) }
        : { ...e, priority: priorityModel, prioritySet: null, priorityModel, whySource: baseSource, why: whyLine({ source: baseSource, modelWhy: modelWhyOf(e) }) };
    });
    setEmails(next); publish(next);
    setBusy(email.id, true);
    try {
      const res = await postPref(email, { priority: p });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchRules();
    } catch (e) {
      setEmails(before); publish(before);
      toast.error("Could not save that priority", e);
    } finally { setBusy(email.id, false); }
  };

  const setKeep = async (email: EmailMessage, keep: boolean) => {
    const before = emails;
    const next = emails.map((e) => (e.id === email.id ? { ...e, keep } : e));
    setEmails(next); publish(next);
    if (keep) setSelected((prev) => { const n = new Set(prev); n.delete(email.id); return n; });
    setBusy(email.id, true);
    try {
      const res = await postPref(email, { keep });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setEmails(before); publish(before);
      toast.error("Could not save Keep", e);
    } finally { setBusy(email.id, false); }
  };

  const senderRule = async (email: EmailMessage, kind: "high" | "low") => {
    const addr = senderAddress(email.from);
    if (!addr) return;
    const ok = await appendPref(kind === "high" ? "vipSenders" : "muteSenders", addr);
    if (!ok) { toast.error("Could not save that rule"); return; }
    applySenderRuleLocally(addr, kind);
    toast.ok(`${addr} is now Always ${kind === "high" ? "High" : "Low"}`, "change it in Preferences → Email rules");
    fetchRules();
  };

  // ---- mark read (E2 guard on the client; E5 failures reported) ----
  const markEmailsRead = async (targets: EmailMessage[]) => {
    const keptN = targets.filter((e) => e.keep).length;
    const toMark = targets.filter((e) => !e.keep);
    if (!toMark.length) { if (keptN) toast.info(`${keptN} kept — nothing to mark`); return; }
    setMarkingRead(true);
    const byAccount = {
      primary: toMark.filter((e) => e.account === "primary"),
      secondary: toMark.filter((e) => e.account === "secondary"),
    };
    const done = new Set<string>();
    let failed = 0, keptByServer = 0, refused: string | null = null;
    try {
      await Promise.all((["primary", "secondary"] as const).filter((a) => byAccount[a].length > 0).map(async (account) => {
        const ids = byAccount[account].map((e) => e.id);
        const res = await fetch("/api/gmail/mark-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, account }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { refused = d?.error || `HTTP ${res.status}`; failed += ids.length; return; }
        for (const id of (Array.isArray(d.done) ? d.done : [])) done.add(id);
        failed += Array.isArray(d.failed) ? d.failed.length : 0;
        keptByServer += Array.isArray(d.kept) ? d.kept.length : 0;
      }));
      if (done.size) {
        setEmails((prev) => { const updated = prev.filter((e) => !done.has(e.id)); publish(updated); return updated; });
        setSelected((prev) => { const n = new Set(prev); done.forEach((id) => n.delete(id)); return n; });
        if (expandedId && done.has(expandedId)) setExpandedId(null);
      }
      if (refused) toast.error("Could not mark read", refused);
      else if (failed) toast.warn(`Gmail refused ${failed} — left in place`, "try again, or sign in again if it persists");
      const keptTotal = keptN + keptByServer;
      if (keptTotal && (done.size || failed)) toast.info(`${keptTotal} kept stayed`);
    } catch {
      toast.error("Could not mark read", "network error");
    } finally {
      setMarkingRead(false);
    }
  };

  const handleMarkSelectedRead = () => markEmailsRead(emails.filter((e) => selected.has(e.id)));

  const fileUnderFamily = async (category: string) => {
    const targets = emails.filter((e) => selected.has(e.id));
    if (!targets.length) return;
    setMarkingRead(true);
    try {
      const results = await Promise.all(
        (["primary", "secondary"] as const)
          .map((account) => targets.filter((e) => e.account === account))
          .filter((list) => list.length > 0)
          .map(async (list) => {
            const r = await fetch("/api/gmail/label", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: list.map((e) => e.id), account: list[0].account, category, senders: list.map((e) => e.from) }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.ok) throw new Error(d?.error || "Label failed");
            return d as { label: string; applied: number; tracked: { domain: string; added: boolean }[] };
          }),
      );
      const applied = results.reduce((n, r) => n + (r.applied ?? 0), 0);
      const added = results.flatMap((r) => r.tracked ?? []).filter((t) => t.added).map((t) => t.domain);
      toast.ok(`Filed ${applied} under ${results[0]?.label ?? "Family"}`, added.length ? `now tracking ${added.join(", ")}` : undefined);
      setSelected(new Set());
    } catch (e) {
      toast.error("Could not file those emails", e);
    } finally {
      setMarkingRead(false);
    }
  };

  const addActionToTasks = async (key: string, action: ActionItem) => {
    if (actionsAdded[key] === "task" || taskStatus.get(key) === "pending") return;
    setTaskStatus((prev) => new Map(prev).set(key, "pending"));
    try {
      const res = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: action.action, due: action.dueDate || undefined, notes: `From: ${action.from}\nRe: ${action.subject}` }) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setTaskStatus((prev) => { const n = new Map(prev); n.delete(key); return n; });
      markAdded(key, "task");
    } catch {
      setTaskStatus((prev) => new Map(prev).set(key, "failed"));
    }
  };

  const addActionToDocs = async (key: string, action: ActionItem) => {
    if (actionsAdded[key] === "doc" || docStatus.get(key) === "pending") return;
    setDocStatus((prev) => new Map(prev).set(key, "pending"));
    try {
      const dueLine = action.dueDate ? `**Due:** ${action.dueDate}\n\n` : "";
      const content = `# ${action.action}\n\n**From:** ${action.from}  ·  **Re:** ${action.subject}\n\n${dueLine}---\n\n## Status\n\n- [ ] Open\n- [ ] In progress\n- [ ] Done\n\n## Subtasks\n\n- [ ] _(break the ask down here)_\n\n## Notes\n\n_(working notes, decisions, references)_\n`;
      const res = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `Track: ${action.action}`.slice(0, 240), content, tags: ["tracking", "action-item"], link: { type: "email", id: action.emailId, title: action.subject } }) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setDocStatus((prev) => { const n = new Map(prev); n.delete(key); return n; });
      markAdded(key, "doc");
    } catch {
      setDocStatus((prev) => new Map(prev).set(key, "failed"));
    }
  };

  // ---- the grouped list ----
  const counts = useMemo(() => ({
    High: emails.filter((e) => e.priority === "High").length,
    Medium: emails.filter((e) => e.priority === "Medium").length,
    Low: emails.filter((e) => e.priority === "Low").length,
    Kept: emails.filter((e) => e.keep).length,
  }), [emails]);

  const groups = useMemo(() => {
    const pick = (p: EmailPriority) => emails.filter((e) => e.priority === p && (filter !== "Kept" || e.keep));
    const order = (list: EmailMessage[]) => [...list.filter((e) => e.keep), ...list.filter((e) => !e.keep)];
    const want = filter === "All" || filter === "Kept" ? GROUPS : [filter];
    return want.map((p) => ({ priority: p, items: order(pick(p)) })).filter((g) => g.items.length > 0 || filter === g.priority);
  }, [emails, filter]);
  const visible = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const selectable = visible.filter((e) => !e.keep);
  const allVisibleSelected = selectable.length > 0 && selectable.every((e) => selected.has(e.id));
  const toggleSelectAll = () => {
    setSelected((prev) => { const n = new Set(prev); if (allVisibleSelected) selectable.forEach((e) => n.delete(e.id)); else selectable.forEach((e) => n.add(e.id)); return n; });
  };
  const toggleSelect = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ---- keyboard triage (E4): j/k move · x select · e read · h keep · 1/2/3 priority · Enter open · Esc ----
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (document.body.dataset.tab !== "email") return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const list = visible;
      if (!list.length) return;
      const idx = focusId ? list.findIndex((e) => e.id === focusId) : -1;
      const cur = idx >= 0 ? list[idx] : null;
      const move = (d: number) => {
        const n = Math.min(list.length - 1, Math.max(0, (idx < 0 ? (d > 0 ? -1 : list.length) : idx) + d));
        const id = list[n].id;
        setFocusId(id);
        document.querySelector<HTMLElement>(`[data-email-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
      };
      switch (ev.key) {
        case "j": case "ArrowDown": ev.preventDefault(); move(1); return;
        case "k": case "ArrowUp": ev.preventDefault(); move(-1); return;
        case "x": if (cur && !cur.keep) { ev.preventDefault(); toggleSelect(cur.id); } return;
        case "e": if (cur && !cur.keep) { ev.preventDefault(); move(1); markEmailsRead([cur]); } return;
        case "h": if (cur) { ev.preventDefault(); setKeep(cur, !cur.keep); } return;
        case "1": case "2": case "3": if (cur) { ev.preventDefault(); const p = (["High", "Medium", "Low"] as EmailPriority[])[Number(ev.key) - 1]; if (cur.priority !== p) setPriority(cur, p); } return;
        case "Enter": case "o": if (cur) { ev.preventDefault(); setExpandedId((v) => (v === cur.id ? null : cur.id)); } return;
        case "Escape": setExpandedId(null); setFocusId(null); return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (status === "unauthenticated") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 text-center">
        <div className="text-4xl">✉️</div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Connect Your Gmail</h2>
        <p className="text-sm text-slate-500 max-w-xs">Sign in with Google to view and triage your emails with AI-powered summaries.</p>
        <a href="/login" className="flex items-center gap-2 bg-slate-800 border border-slate-700 text-slate-200 px-5 py-2.5 rounded-lg font-medium hover:border-green-700 hover:text-green-400 transition-all text-sm">Sign in with Google</a>
      </div>
    );
  }

  const openActions = actions.filter((a) => !actionsDone.has(actionKey(a.emailId, a.action))).length;
  const suggestionRows = rules?.suggestions ?? [];
  const hasRuleRows = suggestionRows.length > 0 || vipSuggestions.length > 0;
  const BTN = "text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border transition-all disabled:opacity-40";
  const BTN_OK = `${BTN} bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-300`;
  const BTN_MUTED = `${BTN} bg-slate-800/80 hover:bg-slate-800 border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200`;

  return (
    <div className="pb-20">
      {/* Action items */}
      {(actionsLoading || actions.length > 0) && (
        <div className="mb-5 bg-amber-500/5 rounded-xl border border-amber-500/30 overflow-hidden glow-amber">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-amber-500/20">
            <div className="w-6 h-6 rounded-md bg-amber-500/15 flex items-center justify-center flex-shrink-0"><span className="text-amber-400 text-xs">⚡</span></div>
            <span className="text-xs font-bold uppercase tracking-widest text-amber-400">Action Items</span>
            {actionsLoading && <span className="text-[10px] text-slate-600 font-mono ml-auto animate-pulse uppercase tracking-wider">Extracting…</span>}
            {!actionsLoading && actions.length > 0 && (
              <span className="ml-auto text-[10px] text-amber-600 font-mono">{openActions} open · {actions.length - openActions} done · remembered across devices</span>
            )}
          </div>
          {actionsLoading && <div className="px-4 py-3 space-y-2.5">{[1, 2].map((i) => <div key={i} className="h-9 bg-slate-800/60 rounded-lg animate-pulse" />)}</div>}
          {!actionsLoading && actions.length > 0 && (
            <ul className="divide-y divide-amber-500/10">
              {actions.map((action, i) => {
                const key = actionKey(action.emailId, action.action);
                const checked = actionsDone.has(key);
                const added = actionsAdded[key];
                const ts = taskStatus.get(key);
                const ds = docStatus.get(key);
                return (
                  <li key={`${key}-${i}`} className={`flex items-start gap-3 px-4 py-2.5 transition-all ${checked ? "opacity-50" : "hover:bg-amber-500/5"}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleActionDone(key)} className="mt-0.5 h-4 w-4 rounded border-amber-700/50 bg-slate-800 accent-amber-500 flex-shrink-0 cursor-pointer" aria-label="Done" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm text-slate-100 ${checked ? "line-through" : ""}`}>{action.action}</p>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                        {action.from} · {action.subject}
                        {action.dueDate && <span className="text-amber-500 ml-2 font-bold">{action.dueDate}</span>}
                        {added && <span className="text-emerald-500 ml-2">· in {added === "task" ? "Tasks" : "Docs"} ✓</span>}
                      </p>
                    </div>
                    <div className="flex-shrink-0 self-center flex items-center gap-1.5">
                      <button onClick={() => addActionToDocs(key, action)} disabled={ds === "pending" || added === "doc"} title={added === "doc" ? "Tracking doc created" : ds === "failed" ? "Failed — click to retry" : "Promote to a tracking doc"} className={`${BTN} ${added === "doc" ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 cursor-default" : ds === "failed" ? "bg-red-500/10 border-red-500/40 text-red-400" : "bg-slate-800/80 border-slate-700 text-slate-400 hover:border-emerald-500/50 hover:text-emerald-300"}`}>
                        {added === "doc" ? "✓ Doc" : ds === "pending" ? "…" : ds === "failed" ? "Retry" : "▤ Doc"}
                      </button>
                      <button onClick={() => addActionToTasks(key, action)} disabled={ts === "pending" || added === "task"} title={added === "task" ? "Added to Google Tasks" : ts === "failed" ? "Failed — click to retry" : "Add to Google Tasks"} className={`${BTN} ${added === "task" ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 cursor-default" : ts === "failed" ? "bg-red-500/10 border-red-500/40 text-red-400" : "bg-slate-800/80 border-slate-700 text-slate-400 hover:border-amber-500/50 hover:text-amber-300"}`}>
                        {added === "task" ? "✓ Task" : ts === "pending" ? "…" : ts === "failed" ? "Retry" : "+ Task"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* How priority is decided */}
      {rules && (
        <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="flex items-center gap-x-3 gap-y-1 px-4 py-2.5 border-b border-slate-800 bg-slate-800/30 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">How priority is decided</span>
            <span className="text-[11.5px] text-slate-300">
              {rules.role ? <>role <b className="text-slate-100 font-semibold">{rules.role}</b> · </> : <span className="text-amber-400">no role declared · </span>}
              <b className="text-slate-100 font-semibold">{rules.priorityTopics}</b> priority topics · <b className="text-slate-100 font-semibold">{rules.vip}</b> VIP · <b className="text-slate-100 font-semibold">{rules.muted}</b> muted
              {rules.corrections.total > 0
                ? <> · you corrected <b className="text-slate-100 font-semibold">{rules.corrections.total}</b> in 30 d ({rules.corrections.promoted} ▲ · {rules.corrections.demoted} ▼)</>
                : <> · <span className="text-slate-500">no corrections yet — change a badge to teach it</span></>}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <button onClick={() => window.dispatchEvent(new CustomEvent("prefs:open", { detail: "email" }))} className={BTN_MUTED}>Rules ⚙</button>
              <button onClick={() => setRulesOpen((v) => !v)} className={`${BTN} border-transparent text-slate-500 hover:text-slate-300`}>what the model reads {rulesOpen ? "▴" : "▾"}</button>
            </span>
          </div>
          {rulesOpen && (
            <ul className="px-4 py-2.5 border-b border-slate-800/70 text-[11.5px] text-slate-400 space-y-0.5 list-disc pl-8">
              {rules.rules.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          {hasRuleRows && (
            <ul className="divide-y divide-slate-800/70">
              {suggestionRows.map((r) => {
                const busy = suggestionBusy.has(r.key);
                return (
                  <li key={r.key} className="flex items-center gap-3 px-4 py-2 text-[12px] text-slate-300 flex-wrap">
                    <span className="text-[8.5px] font-bold uppercase tracking-wider text-violet-300 bg-violet-500/15 rounded px-1.5 py-0.5">suggested rule</span>
                    <span className="flex-1 min-w-[200px]">
                      You {r.kind === "high" ? "promoted" : "demoted"} <b className="text-slate-100">{r.count}</b> emails from <span className="font-mono text-slate-200">{r.sender}</span> — make it <b className="text-slate-100">Always {r.kind === "high" ? "High" : "Low"}</b>?
                      <span className="block text-[10px] text-slate-500">{r.evidence}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <button onClick={() => acceptRule(r)} disabled={busy} className={BTN_OK}>{busy ? "…" : `Yes, always ${r.kind === "high" ? "High" : "Low"}`}</button>
                      <button onClick={() => dismissRule(r)} disabled={busy} title="Never suggest this rule again" className={BTN_MUTED}>Not this sender</button>
                    </span>
                  </li>
                );
              })}
              {vipSuggestions.map((s) => {
                const busy = suggestionBusy.has(s.email);
                const lastDate = s.lastReplyAt ? new Date(s.lastReplyAt) : null;
                const lastFmt = lastDate && !isNaN(lastDate.getTime()) ? lastDate.toLocaleDateString([], { month: "short", day: "numeric" }) : "";
                return (
                  <li key={s.email} className="flex items-center gap-3 px-4 py-2 text-[12px] text-slate-300 flex-wrap">
                    <span className="text-[8.5px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/15 rounded px-1.5 py-0.5">suggested VIP</span>
                    <span className="flex-1 min-w-[200px]">
                      You replied to <span className="font-mono text-slate-200">{s.email}</span> <b className="text-slate-100">{s.count}</b> times in 30 d — make the sender <b className="text-slate-100">Always High</b>?
                      {lastFmt && <span className="block text-[10px] text-slate-500">last reply {lastFmt}</span>}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <button onClick={() => acceptSuggestion(s)} disabled={busy} className={BTN_OK}>{busy ? "…" : "Yes, always High"}</button>
                      <button onClick={() => dismissSuggestion(s)} disabled={busy} title="Don't suggest again" className={BTN_MUTED}>Not this sender</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Mail size={14} strokeWidth={2.25} className="text-emerald-500" />
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">Inbox</h2>
          {!loading && (
            <span className="text-xs text-slate-600 font-mono">{emails.length} unread{counts.Kept ? ` · ${counts.Kept} kept` : ""}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <AddAccountButton connected={secondaryConnected} primaryEmail={primaryEmail} secondaryEmail={secondaryEmail} onRevoked={() => { setSecondaryConnected(false); setSecondaryEmail(undefined); fetchEmails(true); }} />
          {lastUpdated && !loading && <span className="text-[10px] text-slate-700 font-mono">{formatUpdated(lastUpdated)}</span>}
          <button onClick={() => fetchEmails(true)} disabled={loading} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-400 disabled:opacity-40 font-mono transition-colors">
            <span className={`text-base leading-none ${loading ? "animate-spin" : ""}`}>↻</span>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Filter chips with counts + keyboard hint */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {([["All", emails.length], ["High", counts.High], ["Medium", counts.Medium], ["Low", counts.Low], ["Kept", counts.Kept]] as [Filter, number][]).map(([f, n]) => {
          const on = filter === f;
          const cls = f === "All" ? (on ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300" : "border-slate-700 text-slate-400 hover:border-slate-500")
            : f === "Kept" ? (on ? "bg-violet-500/15 border-violet-500/50 text-violet-200" : "border-violet-500/25 text-violet-300/70 hover:border-violet-500/50")
            : on ? GROUP_STYLE[f].chipOn : GROUP_STYLE[f].chip;
          return (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border transition-all ${cls}`}>
              {f === "Kept" ? "⚑ Kept" : f} <span className="font-mono font-normal opacity-70">{n}</span>
            </button>
          );
        })}
        <span className="ml-auto hidden lg:inline text-[10px] text-slate-600 font-mono">
          <kbd className="px-1 border border-slate-800 rounded">j</kbd>/<kbd className="px-1 border border-slate-800 rounded">k</kbd> move · <kbd className="px-1 border border-slate-800 rounded">x</kbd> select · <kbd className="px-1 border border-slate-800 rounded">e</kbd> read · <kbd className="px-1 border border-slate-800 rounded">h</kbd> keep · <kbd className="px-1 border border-slate-800 rounded">1</kbd><kbd className="px-1 border border-slate-800 rounded">2</kbd><kbd className="px-1 border border-slate-800 rounded">3</kbd> priority
        </span>
      </div>

      {secondaryNotice && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-xl p-3 mb-4 text-xs flex items-start justify-between gap-3">
          <span>{secondaryNotice}</span>
          <button onClick={() => setSecondaryNotice(null)} className="text-amber-400 hover:text-amber-200 flex-shrink-0" aria-label="Dismiss">✕</button>
        </div>
      )}
      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 mb-4 text-sm">{error}</div>}

      {loading && (
        <div className="space-y-2.5">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 bg-slate-900 rounded-xl border border-slate-800 animate-pulse" />)}</div>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="flex items-center justify-between mb-2 px-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} className="h-4 w-4 rounded border-slate-700 bg-slate-800 accent-emerald-500" />
            <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">{allVisibleSelected ? "Deselect all" : `Select all ${selectable.length}`}{visible.length - selectable.length > 0 ? ` · ${visible.length - selectable.length} kept excluded` : ""}</span>
          </label>
        </div>
      )}

      {!loading && !error && (
        visible.length === 0 ? (
          <div className="text-center py-16 text-slate-600 text-sm font-mono uppercase tracking-wider">
            {emails.length === 0 ? "Inbox clear — no unread emails" : filter === "Kept" ? "Nothing kept" : "No emails in this group"}
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const style = GROUP_STYLE[g.priority];
              const keptN = g.items.filter((e) => e.keep).length;
              const clearable = g.items.filter((e) => !e.keep);
              const compact = g.priority === "Low";
              return (
                <section key={g.priority} className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                  <header className="flex items-center gap-2.5 px-4 py-2 bg-slate-950/50 border-b border-slate-800">
                    <span className={`text-[10.5px] font-bold uppercase tracking-widest ${style.label}`}>{g.priority}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{g.items.length}{keptN ? ` · ${keptN} kept` : ""}{compact ? " · compact — tap a row to open" : ""}</span>
                    <span className="ml-auto flex items-center gap-2">
                      {keptN > 0 && <span className="text-[10px] text-slate-500">kept never auto-reads</span>}
                      {clearable.length > 0 && (
                        <button onClick={() => markEmailsRead(clearable)} disabled={markingRead} className={`${BTN} ${g.priority === "Low" ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25" : "border-slate-700 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300"}`}>
                          {markingRead ? "Marking…" : `✓ Mark ${g.priority === "Low" && filter !== "Kept" ? "all " : ""}${clearable.length} read`}
                        </button>
                      )}
                    </span>
                  </header>
                  <div>
                    {g.items.map((email) => (
                      <EmailCard
                        key={email.id}
                        email={email}
                        selected={selected.has(email.id)}
                        previousSeen={previousSeen}
                        compact={compact}
                        expanded={expandedId === email.id}
                        focused={focusId === email.id}
                        showAccount={secondaryConnected}
                        busy={busyIds.has(email.id)}
                        onToggle={toggleSelect}
                        onExpand={(id) => { setExpandedId(id); if (id) setFocusId(id); }}
                        onMarkRead={(e) => markEmailsRead([e])}
                        onSetPriority={setPriority}
                        onKeep={setKeep}
                        onSenderRule={senderRule}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )
      )}

      <BulkActionBar count={selected.size} onMarkRead={handleMarkSelectedRead} onFileFamily={fileUnderFamily} onClear={() => setSelected(new Set())} loading={markingRead} />
    </div>
  );
}
