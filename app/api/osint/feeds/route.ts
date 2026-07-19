import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getUserPrefs, saveOsintFeeds } from "@/lib/userPrefs";
import { sanitizeOsintFeeds } from "@/lib/osintFeeds";

export const dynamic = "force-dynamic";

// Inline OSINT-feed editing for the Sources pane. Feeds are SHARED team config,
// so reads are open to any allowlisted user but writes are owner-only (crew get
// canEdit=false and a read-only list). The PUT touches only the osint_feeds
// column via saveOsintFeeds — it can't clobber the rest of the shared prefs.
//   GET → { feeds, canEdit }
//   PUT { feeds } → owner-only; sanitized replace

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);
  const prefs = await getUserPrefs(email).catch(() => null);
  return NextResponse.json({ feeds: prefs?.osintFeeds ?? [], canEdit: isOwner(email) });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);
  if (!isOwner(email)) return NextResponse.json({ error: "OSINT feeds are shared team config — owner only." }, { status: 403 });

  let body: { feeds?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const feeds = sanitizeOsintFeeds(body.feeds);
  try {
    await saveOsintFeeds(feeds);
    return NextResponse.json({ ok: true, feeds });
  } catch {
    return NextResponse.json({ error: "Could not save feeds — database unavailable." }, { status: 500 });
  }
}
