"use client";

import { useEffect, useState } from "react";
import { AiFeature, AiUsageSummary, AiUsageDay } from "@/lib/types";
import { ALL_AI_FEATURES, AI_FEATURE_LABELS } from "@/lib/aiFeatures";

// Split out of components/PreferencesDrawer.tsx (housekeeping 2026-11-04).

// ─── AI control panel (toggles + spend) ──────────────────────────────────────

function formatUsd(micros: number): string {
  const usd = micros / 1_000_000;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

// Map a route name back to its human label, falling back to the raw route id
// if a new route name lands without a label entry.
// Most logged routes share a name with their AI feature toggle, so the label
// comes for free. These don't — either the route predates the toggle (the
// per-surface reads) or the names simply diverged (news_curated vs the
// news_overview feature) — and without an entry the breakdown shows a raw
// route name, which reads like a bug when you're auditing spend.
const ROUTE_LABEL_OVERRIDES: Record<string, string> = {
  news_curated: "News overview",
  crisis_read: "Crisis map read",
  force_read: "Force protection read",
  ground_sitrep: "Country SITREP",
  sitrep_read: "Base commander's read",
  commands_read: "Command board read",
  ask: "Ask the board",
};

const ROUTE_LABEL: Record<string, string> = {
  ...Object.fromEntries(ALL_AI_FEATURES.map((f) => [f, AI_FEATURE_LABELS[f].label])),
  ...ROUTE_LABEL_OVERRIDES,
};

export default function AIControlPanel({
  aiEnabled, onAiEnabled, toggles, onToggles,
}: {
  aiEnabled: boolean;
  onAiEnabled: (v: boolean) => void;
  toggles: Partial<Record<AiFeature, boolean>>;
  onToggles: (v: Partial<Record<AiFeature, boolean>>) => void;
}) {
  const [usage, setUsage] = useState<{
    today: AiUsageSummary; last7: AiUsageSummary; last30: AiUsageSummary;
    monthToDate: AiUsageSummary; byDay: AiUsageDay[]; keyTail?: string | null; keyFormat?: string | null; aiHealth?: string | null;
  } | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [breakdownWindow, setBreakdownWindow] = useState<"today" | "last7" | "last30">("today");

  useEffect(() => {
    fetch("/api/ai-usage")
      .then((r) => r.json())
      .then((d) => setUsage({
        today: d.today, last7: d.last7, last30: d.last30,
        monthToDate: d.monthToDate, byDay: Array.isArray(d.byDay) ? d.byDay : [],
        keyTail: typeof d.keyTail === "string" ? d.keyTail : null,
        aiHealth: typeof d.aiHealth === "string" ? d.aiHealth : null,
        keyFormat: typeof d.keyFormat === "string" ? d.keyFormat : null,
      }))
      .catch(() => {});
  }, []);

  const setFeature = (feature: AiFeature, enabled: boolean) => {
    onToggles({ ...toggles, [feature]: enabled });
  };

  // Per-feature toggles are opt-out: missing key = enabled. Master switch
  // off greys out everything regardless of per-feature state.
  const featureEnabled = (f: AiFeature) =>
    aiEnabled && toggles[f] !== false;

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        AI Controls
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        Disable Anthropic API calls per feature or globally. All features fall
        back to non-AI behaviour when off — no errors, just degraded output
        (snippets instead of summaries, etc).
      </p>

      {/* Why the AI went quiet. Every feature degrades to a placeholder on
          failure, so without this a rejected key reads as "no results". */}
      {usage?.aiHealth && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 mb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-red-300 mb-0.5">AI calls are failing</p>
          <p className="text-[11px] text-red-200/90 leading-snug">{usage.aiHealth}</p>
        </div>
      )}

      {/* Master switch */}
      <div className={`rounded-lg border p-3 mb-3 ${
        aiEnabled ? "bg-emerald-500/10 border-emerald-500/40" : "bg-red-500/10 border-red-500/40"
      }`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onAiEnabled(!aiEnabled)}
            role="switch"
            aria-checked={aiEnabled}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
              aiEnabled ? "bg-emerald-500" : "bg-slate-700"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              aiEnabled ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-bold ${aiEnabled ? "text-emerald-300" : "text-red-300"}`}>
              {aiEnabled ? "AI features ENABLED" : "AI features DISABLED (all)"}
            </p>
            <p className="text-[10px] text-slate-500 font-mono leading-snug">
              Master kill switch. Off = no Anthropic API calls anywhere.
            </p>
          </div>
        </div>
      </div>

      {/* Per-feature toggles */}
      <ul className={`space-y-1 mb-3 ${aiEnabled ? "" : "opacity-50"}`}>
        {ALL_AI_FEATURES.map((f) => {
          const enabled = featureEnabled(f);
          const meta = AI_FEATURE_LABELS[f];
          return (
            <li key={f} className="flex items-center gap-2.5 py-1.5">
              <button
                onClick={() => setFeature(f, !(toggles[f] !== false))}
                disabled={!aiEnabled}
                role="switch"
                aria-checked={enabled}
                className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 disabled:cursor-not-allowed ${
                  enabled ? "bg-emerald-500" : "bg-slate-700"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  enabled ? "translate-x-4" : "translate-x-0"
                }`} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-200 leading-tight">{meta.label}</p>
                <p className="text-[10px] text-slate-600 font-mono leading-tight">{meta.sub}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Usage summary */}
      {usage && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Today's spend
            </p>
            <span className="text-[10px] text-slate-600 font-mono">
              {usage.today.totalCalls} call{usage.today.totalCalls === 1 ? "" : "s"}
            </span>
          </div>
          <p className={`text-2xl font-bold ${
            usage.today.totalMicros === 0 ? "text-slate-500" : "text-emerald-300"
          }`}>
            {formatUsd(usage.today.totalMicros)}
          </p>
          {/* Which key this deploy is actually holding (owner-only). After a
              rotation, match these 4 characters against the Console's masked
              key to confirm the swap landed — without spending to find out. */}
          {usage.keyFormat === "missing" && (
            <p className="text-[10px] font-bold text-red-300 mt-0.5">
              ANTHROPIC_API_KEY is NOT SET on this server — every AI feature is off.
            </p>
          )}
          {usage.keyTail && (
            <p className="text-[9px] text-slate-600 font-mono mt-0.5" title="Last 4 characters of the API key this server is using">
              key ···{usage.keyTail}
              {usage.keyFormat === "whitespace" && (
                <span className="text-amber-400"> · stored with surrounding whitespace (trimmed at use — clean it in the hosting env)</span>
              )}
              {usage.keyFormat === "unexpected-prefix" && (
                <span className="text-amber-400"> · does not start with sk-ant- — wrong value pasted?</span>
              )}
            </p>
          )}
          <div className="flex items-baseline justify-between gap-2 mt-1.5 pt-1.5 border-t border-slate-700/60 text-[10px] font-mono">
            <span className="text-slate-500">Last 7 days</span>
            <span className="text-slate-300">{formatUsd(usage.last7.totalMicros)}</span>
          </div>
          {/* Month-to-date is the line that matches an Anthropic Console MONTHLY
              spend threshold — compare alerts against THIS number, not "today". */}
          <div className="flex items-baseline justify-between gap-2 text-[10px] font-mono">
            <span className="text-emerald-600">This month (to date)</span>
            <span className="text-emerald-300 font-bold">{formatUsd(usage.monthToDate.totalMicros)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-[10px] font-mono">
            <span className="text-slate-500">Last 30 days</span>
            <span className="text-slate-300">{formatUsd(usage.last30.totalMicros)}</span>
          </div>

          {/* Per-day trend — distinguishes a steady rate from one bad day. */}
          {usage.byDay.length > 1 && (() => {
            const peak = Math.max(...usage.byDay.map((d) => d.micros), 1);
            return (
              <div className="mt-2 pt-2 border-t border-slate-700/60">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Daily — last {usage.byDay.length} days
                </p>
                <ul className="space-y-0.5">
                  {usage.byDay.slice().reverse().map((d) => (
                    <li key={d.day} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className="text-slate-500 w-11 flex-shrink-0">{d.day.slice(5)}</span>
                      <span className="flex-1 h-1.5 bg-slate-900/60 rounded-sm overflow-hidden">
                        <span
                          className="block h-full bg-emerald-500/70 rounded-sm"
                          style={{ width: `${Math.max(2, (d.micros / peak) * 100)}%` }}
                        />
                      </span>
                      <span className="text-slate-400 w-14 text-right flex-shrink-0">{formatUsd(d.micros)}</span>
                      <span className="text-slate-600 w-24 truncate hidden sm:block" title={`biggest line: ${d.topRoute}`}>
                        {ROUTE_LABEL[d.topRoute] ?? d.topRoute}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {usage.today.byRoute.length > 0 && (
            <>
              <button
                onClick={() => setShowBreakdown((v) => !v)}
                className="text-[10px] text-slate-500 hover:text-slate-300 font-mono mt-2 transition-colors"
              >
                {showBreakdown ? "▴ Hide" : "▾ Show"} breakdown
              </button>
              {showBreakdown && (() => {
                // Every window's byRoute/byUser is already computed server-side;
                // pinning the breakdown to "today" hid the one comparison that
                // makes "shared" legible — today (post-attribution-fix) against
                // 30 days (mostly rows written before every route passed a user).
                const sel = breakdownWindow === "today" ? usage.today
                  : breakdownWindow === "last7" ? usage.last7 : usage.last30;
                return (
                  <>
                    <div className="flex items-center gap-1 mt-2">
                      {([
                        ["today", "Today"],
                        ["last7", "7 days"],
                        ["last30", "30 days"],
                      ] as const).map(([id, label]) => (
                        <button
                          key={id}
                          onClick={() => setBreakdownWindow(id)}
                          className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border transition-colors ${
                            breakdownWindow === id
                              ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10"
                              : "border-slate-700 text-slate-600 hover:text-slate-400"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      <span className="ml-auto text-[9px] text-slate-600 font-mono">
                        {formatUsd(sel.totalMicros)} · {sel.totalCalls}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-0.5">
                      {sel.byRoute.map((r) => (
                        <li key={r.route} className="flex items-baseline justify-between gap-2 text-[10px] font-mono">
                          <span className="text-slate-400 truncate">
                            {ROUTE_LABEL[r.route] ?? r.route}
                          </span>
                          <span className="text-slate-500 flex-shrink-0">
                            {formatUsd(r.micros)} · {r.calls}
                            {typeof r.p50Ms === "number" && (
                              <span className="text-slate-600" title="Model-call latency p50 / p95">
                                {" "}· {(r.p50Ms / 1000).toFixed(1)}s{typeof r.p95Ms === "number" && r.p95Ms !== r.p50Ms ? `/${(r.p95Ms / 1000).toFixed(1)}s` : ""}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {/* Per-user attribution for the SAME window. "shared" = rows
                        logged with no session email; since every route now passes
                        one, a large shared slice in a recent window means an
                        unattributed call site, while a large one at 30 days is
                        just history from before the fix. */}
                    {(sel.byUser?.length ?? 0) > 0 && (
                      <>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mt-3 mb-1">
                          By user — {breakdownWindow === "today" ? "today" : breakdownWindow === "last7" ? "last 7 days" : "last 30 days"}
                        </p>
                        <ul className="space-y-0.5">
                          {sel.byUser.map((u) => (
                            <li key={u.user} className="flex items-baseline justify-between gap-2 text-[10px] font-mono">
                              <span className={u.user === "shared" ? "text-amber-500/80 truncate" : "text-slate-400 truncate"}>
                                {u.user}
                              </span>
                              <span className="text-slate-500 flex-shrink-0">{formatUsd(u.micros)} · {u.calls}</span>
                            </li>
                          ))}
                        </ul>
                        {sel.byUser.some((u) => u.user === "shared") && (
                          <p className="text-[9px] text-slate-600 mt-1 leading-snug">
                            &ldquo;shared&rdquo; = calls logged without a signed-in identity. Every route
                            now records one, so this should only appear for older rows.
                          </p>
                        )}
                      </>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </div>
      )}
    </div>
  );
}
