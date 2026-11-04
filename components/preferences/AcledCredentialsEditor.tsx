"use client";

import { useEffect, useState } from "react";

// Split out of components/PreferencesDrawer.tsx (housekeeping 2026-11-04).

// ─── ACLED credentials editor ────────────────────────────────────────────────
// Self-contained: reads/writes its own /api/settings/acled endpoint rather than
// riding the main prefs object, so the password stays server-side and a prefs
// Save never touches it. Has its own Save/Clear independent of the drawer's
// footer Save button.
export default function AcledCredentialsEditor() {
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"env" | "settings" | null>(null);
  const [savedEmail, setSavedEmail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [diag, setDiag] = useState<string[] | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  // Live end-to-end check of all three Crisis-map sources — turns "no data"
  // into a concrete status (token vs read failure, GDELT/GPSJam reachability).
  const runDiag = async () => {
    setDiagBusy(true); setDiag(null);
    try {
      const r = await fetch("/api/osint/crisis-diag");
      const d = await r.json();
      const lines: string[] = [];
      const a = d.acled ?? {};
      lines.push(
        !a.configured ? "ACLED: not configured."
        : !a.tokenOk ? `ACLED: ✗ login failed — ${a.note ?? a.error ?? "token rejected"}`
        : `ACLED: token OK · read HTTP ${a.readStatus ?? "?"} · ${a.count ?? 0} events${a.sample ? ` (e.g. ${a.sample})` : ""}`,
      );
      if (a.error && a.tokenOk) lines.push(`  ↳ ACLED said: "${a.error}"`);
      if (a.note && a.tokenOk) lines.push(`  ↳ ${a.note}`);
      const g = d.gdelt ?? {};
      lines.push("GDELT variants:");
      for (const v of g.variants ?? []) {
        lines.push(`  · ${v.label}: HTTP ${v.status}${v.status === 200 ? ` · ${v.features ?? 0} results` : v.body ? ` — ${v.body}` : ""}`);
      }
      if (g.note) lines.push(`  ↳ ${g.note}`);
      const j = d.gpsjam ?? {};
      lines.push(`GPSJam: today HTTP ${j.today?.status ?? "?"}, yesterday HTTP ${j.yesterday?.status ?? "?"}${j.note ? ` — ${j.note}` : ""}`);
      setDiag(lines);
    } catch {
      setDiag(["Diagnostic request failed — are you still signed in?"]);
    } finally {
      setDiagBusy(false);
    }
  };

  useEffect(() => {
    fetch("/api/settings/acled")
      .then((r) => r.json())
      .then((d: { source?: "env" | "settings" | null; email?: string }) => {
        setSource(d.source ?? null);
        setSavedEmail(d.email ?? "");
        setEmail(d.email ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/settings/acled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tone: "err", text: d?.error || "Save failed." }); return; }
      setSavedEmail(d.email ?? email.trim());
      setSource("settings");
      setPassword("");
      setMsg(d.verified
        ? { tone: "ok", text: "Saved & verified — the ACLED layer will populate on the next Crisis-map refresh." }
        : { tone: "warn", text: "Saved, but ACLED didn't accept these credentials (or was unreachable). Double-check the email/password and that your account is verified." });
    } catch {
      setMsg({ tone: "err", text: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/settings/acled", { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tone: "err", text: d?.error || "Couldn't clear." }); return; }
      setSavedEmail(""); setEmail(""); setPassword(""); setSource(null);
      setMsg({ tone: "ok", text: "Credentials cleared — the ACLED layer is now off." });
    } catch {
      setMsg({ tone: "err", text: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  };

  const msgClass = msg?.tone === "ok" ? "text-emerald-400" : msg?.tone === "warn" ? "text-amber-400" : "text-red-400";

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        ACLED Strikes <span className="text-slate-600 font-normal normal-case tracking-normal">· Crisis-map layer</span>
      </label>
      <p className="text-[10px] text-slate-600 mb-2 leading-relaxed">
        Structured conflict events (precise strikes/battles with sub-event type, actors, fatalities) on the OSINT → Crisis
        map. Register a free account at <a href="https://acleddata.com/register/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">acleddata.com/register</a>,
        then enter that account&apos;s email + password — ACLED uses OAuth, so this is the login, not an API key. Stored
        server-side; the password is never sent back to the browser. Data © ACLED.
      </p>

      {loading ? (
        <div className="h-9 bg-slate-900/60 border border-slate-800 rounded-md animate-pulse" />
      ) : source === "env" ? (
        <div className="text-[11px] text-slate-400 bg-slate-900/40 border border-slate-800 rounded-md px-3 py-2">
          <span className="text-emerald-400 font-bold">✓ Configured via environment variable</span>
          {savedEmail && <span className="font-mono text-slate-500"> · {savedEmail}</span>}
          <p className="text-[10px] text-slate-600 mt-1">Managed by the deployment&apos;s env vars (<code>ACLED_EMAIL</code> / <code>ACLED_PASSWORD</code>); clear those to edit here instead.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ACLED account email"
            className="w-full bg-slate-900/60 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-slate-600"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={savedEmail ? "Password (leave blank to keep current)" : "ACLED account password"}
            className="w-full bg-slate-900/60 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-slate-600"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !email.trim() || !password}
              className="px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {busy ? "Saving…" : savedEmail ? "Update & verify" : "Save & verify"}
            </button>
            {savedEmail && (
              <button
                type="button"
                onClick={clear}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider border border-slate-700 text-slate-400 hover:border-red-500/40 hover:text-red-400 disabled:opacity-40 transition-all"
              >
                Clear
              </button>
            )}
            {savedEmail && <span className="text-[10px] font-mono text-slate-600">current: {savedEmail}</span>}
          </div>
          {msg && <p className={`text-[10px] leading-snug ${msgClass}`}>{msg.text}</p>}
        </div>
      )}

      {/* Live data-source check — covers ACLED + the keyless GDELT/GPSJam
          layers, so "source down" / "no ACLED data" becomes a concrete status. */}
      {!loading && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-800/60">
          <button
            type="button"
            onClick={runDiag}
            disabled={diagBusy}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200 disabled:opacity-40 transition-all"
            title="Live check: runs the ACLED token + read and pings GDELT / GPSJam from the server"
          >
            {diagBusy ? "Checking…" : "Run data-source check"}
          </button>
          {diag && (
            <pre className="mt-2 text-[10px] leading-relaxed text-slate-400 font-mono whitespace-pre-wrap bg-slate-950/50 border border-slate-800 rounded-md p-2.5">{diag.join("\n")}</pre>
          )}
        </div>
      )}
    </div>
  );
}
