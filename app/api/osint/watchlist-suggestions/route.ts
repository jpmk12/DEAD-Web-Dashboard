import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getUserPrefs, saveUserPrefs } from "@/lib/userPrefs";
import { getTrendMovers } from "@/lib/trends";
import { suggestWatchlist, addKey, dropKey } from "@/lib/watchlistSuggest";

export const dynamic = "force-dynamic";

// Watchlist recommendations. No model call and no new fetch — this reads the
// signal history six existing sources already write, so it costs one indexed
// aggregate and nothing else.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prefs = await getUserPrefs(normEmail(session.user?.email)).catch(() => null);
  if (!prefs) return NextResponse.json({ add: [], drop: [] });

  // A wide limit: the pure layer does the filtering, and asking for more rows
  // costs nothing but lets a genuinely busy week surface more candidates.
  const movers = await getTrendMovers({ limit: 120 }).catch(() => []);
  return NextResponse.json(
    suggestWatchlist(movers, prefs.watchlist ?? [], prefs.dismissedWatchSuggestions ?? []),
  );
}

// Accept or decline one recommendation.
//   { action: "add",     term }  → append to the watchlist
//   { action: "remove",  term }  → drop it from the watchlist
//   { action: "dismiss", term, direction: "add" | "drop" } → never suggest again
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // The watchlist is team config, and saveUserPrefs writes the shared row.
  if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  let body: { action?: string; term?: string; direction?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const term = String(body.term ?? "").trim().slice(0, 100);
  if (!term) return NextResponse.json({ error: "Missing term" }, { status: 400 });

  const prefs = await getUserPrefs(normEmail(session.user?.email));
  const watchlist = [...(prefs.watchlist ?? [])];
  const dismissed = [...(prefs.dismissedWatchSuggestions ?? [])];
  const lower = term.toLowerCase();

  switch (body.action) {
    case "add":
      if (!watchlist.some((w) => w.trim().toLowerCase() === lower)) watchlist.push(term);
      break;
    case "remove": {
      const i = watchlist.findIndex((w) => w.trim().toLowerCase() === lower);
      if (i >= 0) watchlist.splice(i, 1);
      // Also stop recommending its removal — the advice has been taken, and a
      // term that is gone can't be "fading" any more.
      if (!dismissed.includes(dropKey(term))) dismissed.push(dropKey(term));
      break;
    }
    case "dismiss": {
      const key = body.direction === "drop" ? dropKey(term) : addKey(term);
      if (!dismissed.includes(key)) dismissed.push(key);
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    await saveUserPrefs({ ...prefs, watchlist, dismissedWatchSuggestions: dismissed });
  } catch (err) {
    console.error("Watchlist suggestion write failed:", err);
    return NextResponse.json({ error: "Could not save — database error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, watchlist });
}
