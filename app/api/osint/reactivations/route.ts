import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getSaved } from "@/lib/saved";
import { listDocuments } from "@/lib/documents";
import { getTrendMovers } from "@/lib/trends";
import { activeWarningProblems } from "@/lib/warningProblems";
import { assessWarning } from "@/lib/warningAssess";
import { getDisasters } from "@/lib/disasters";
import { getUserPrefs, saveUserPrefs } from "@/lib/userPrefs";
import {
  findReactivations, dismissKey, SIGNAL_WEIGHT,
  type Interest, type ActiveSignal,
} from "@/lib/reactivation";

export const dynamic = "force-dynamic";

// "You cared about this before — it just moved."
//
// A join across surfaces that each only know TODAY. No model call and no new
// fetch: every source here is already cached (trend movers are one indexed
// aggregate, assessWarning is 10-min cached per problem, getDisasters is the
// shared feed the map and Weather tab already pull).
//
// Dismissals share `user_prefs.dismissed_watch_suggestions` as a THIRD
// namespace (`react:<kind>:<id>:<term>`, alongside the bare add-term and
// `drop:term`). One column, three prefixes, no migration — the keys cannot
// collide because every reactivation key is prefixed.

const DAY = 86_400_000;
const ageDaysFrom = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / DAY)) : NaN;
};

/** Collect what is active right now across the three surfaces. */
async function gatherSignals(): Promise<ActiveSignal[]> {
  const out: ActiveSignal[] = [];

  // 1. Trend movers — what is surging in the user's own feeds.
  const movers = await getTrendMovers({ kinds: ["topic", "region", "aor", "watch"], limit: 30 }).catch(() => []);
  for (const m of movers) {
    if (m.state !== "new" && m.state !== "rising") continue;
    out.push({
      term: m.term,
      kind: "mover",
      detail: m.state === "new"
        ? `newly active — ${m.cur} mentions this week`
        : `rising — ${m.cur} mentions this week, up from ${m.prev}`,
      weight: m.state === "new" ? SIGNAL_WEIGHT.moverNew : SIGNAL_WEIGHT.moverRising,
    });
  }

  // 2. I&W boards above calm. The problem label is "COCOM · Subject"; the
  //    SUBJECT is the matchable term — "CENTCOM" would match half the corpus.
  const problems = await activeWarningProblems().catch(() => []);
  const assessed = await Promise.all(problems.map((p) => assessWarning(p.def.id).catch(() => null)));
  for (const a of assessed) {
    if (!a || a.level === "calm") continue;
    const subject = String(a.label ?? "").split("·").pop()?.trim();
    if (!subject) continue;
    out.push({
      term: subject,
      kind: "iw",
      detail: `at ${a.level.toUpperCase()} on the I&W board`,
      weight: a.level === "alert" ? SIGNAL_WEIGHT.iwAlert
        : a.level === "warning" ? SIGNAL_WEIGHT.iwWarning
        : SIGNAL_WEIGHT.iwWatch,
    });
  }

  // 3. Disasters — country is the matchable term, not the headline.
  const disasters = await getDisasters().catch(() => []);
  for (const d of disasters.slice(0, 40)) {
    if (!d.country) continue;
    out.push({
      term: d.country,
      kind: "disaster",
      detail: `in a ${d.severity} ${d.type} alert (${d.source})`,
      weight: d.severity === "red" ? SIGNAL_WEIGHT.disasterRed : SIGNAL_WEIGHT.disasterOther,
    });
  }

  // Keep the strongest instance of each term — one "Iran" row, not five.
  const best = new Map<string, ActiveSignal>();
  for (const s of out) {
    const k = s.term.toLowerCase();
    const cur = best.get(k);
    if (!cur || s.weight > cur.weight) best.set(k, s);
  }
  return [...best.values()];
}

/** Things the user previously chose to keep. */
async function gatherInterests(email: string): Promise<Interest[]> {
  const [saved, docs] = await Promise.all([
    getSaved(email).catch(() => []),
    listDocuments({ limit: 300 }).catch(() => []),
  ]);

  const out: Interest[] = saved.map((s) => ({
    kind: "saved" as const,
    id: s.id,
    title: s.title,
    // Bounded: enough to catch a term named in the body, small enough that a
    // long clipping can't dominate the match surface.
    body: (s.content ?? "").slice(0, 1200),
    origin: `Saved · ${s.source || s.type}`,
    ageDays: ageDaysFrom(s.savedAt),
    link: s.link,
  }));

  for (const d of docs) {
    if (d.archived) continue;
    out.push({
      kind: "doc",
      id: d.id,
      title: d.title,
      // Aliases only — NOT content. A doc's title and aliases are a deliberate
      // statement of subject; its body is a draft that mentions everything.
      body: (d.aliases ?? []).join("\n"),
      origin: `Doc · ${d.docType || "note"}`,
      ageDays: ageDaysFrom(d.updatedAt),
    });
  }
  return out;
}

export async function GET() {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [interests, signals, prefs] = await Promise.all([
    gatherInterests(email),
    gatherSignals(),
    getUserPrefs(email).catch(() => null),
  ]);

  const items = findReactivations(interests, signals, prefs?.dismissedWatchSuggestions ?? []);
  return NextResponse.json({
    items,
    // So the card can explain itself when empty rather than just vanishing.
    scanned: { interests: interests.length, signals: signals.length },
  });
}

// POST { kind, id, term } — permanently stop proposing this pairing.
export async function POST(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // saveUserPrefs writes the shared team row, so the same owner gate as the
  // watchlist-suggestions POST applies.
  if (!isOwner(email)) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as { kind?: string; id?: string; term?: string } | null;
  const kind = body?.kind === "doc" ? "doc" : body?.kind === "saved" ? "saved" : null;
  const id = typeof body?.id === "string" ? body.id.slice(0, 255) : "";
  const term = typeof body?.term === "string" ? body.term.slice(0, 120) : "";
  if (!kind || !id || !term) {
    return NextResponse.json({ error: "kind, id and term are required" }, { status: 400 });
  }

  const prefs = await getUserPrefs(email);
  const dismissed = [...(prefs.dismissedWatchSuggestions ?? [])];
  const key = dismissKey({ kind, id }, term);
  if (!dismissed.includes(key)) dismissed.push(key);
  await saveUserPrefs({ ...prefs, dismissedWatchSuggestions: dismissed });

  return NextResponse.json({ ok: true });
}
