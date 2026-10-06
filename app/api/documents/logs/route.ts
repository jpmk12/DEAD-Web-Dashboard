import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listLogs } from "@/lib/documents";
import { latestEntry, entryCount, entryExcerpt } from "@/lib/docAppend";

export const dynamic = "force-dynamic";

// GET /api/documents/logs — the running logs with their newest entry, for the
// Docs landing and the Append picker. No content ships: just the latest
// entry's excerpt, source and date, plus the entry count.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const logs = await listLogs(40);
  return NextResponse.json({
    logs: logs.map((l) => {
      const last = latestEntry(l.content);
      return {
        id: l.id, title: l.title, aliases: l.aliases, tags: l.tags, pinned: l.pinned, updatedAt: l.updatedAt,
        entries: entryCount(l.content),
        latest: last ? { date: last.date, source: last.source, excerpt: entryExcerpt(last) } : null,
      };
    }),
  });
}
