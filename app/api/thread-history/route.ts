import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getRecentSessions,
  getLabelHistory,
  getLabelSummaries,
  searchThreads,
  getLabelHeatmap,
} from "@/lib/threadHistory";

export const dynamic = "force-dynamic";

const VALID_VIEWS = new Set(["sessions", "label", "labels", "search", "heatmap"]);

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") ?? "sessions";
  const days = Math.min(90, Math.max(1, Number(searchParams.get("days") ?? "30")));

  if (!VALID_VIEWS.has(view)) {
    return NextResponse.json({ error: "Invalid view" }, { status: 400 });
  }

  try {
    switch (view) {
      case "sessions":
        return NextResponse.json({ sessions: await getRecentSessions(days) });

      case "label": {
        const label = searchParams.get("label")?.slice(0, 100);
        if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
        return NextResponse.json({ history: await getLabelHistory(label, days) });
      }

      case "labels":
        return NextResponse.json({ labels: await getLabelSummaries(days) });

      case "search": {
        const q = searchParams.get("q")?.slice(0, 200).trim();
        if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });
        return NextResponse.json({ results: await searchThreads(q, days) });
      }

      case "heatmap":
        return NextResponse.json({ heatmap: await getLabelHeatmap(days) });
    }
  } catch (err) {
    console.error("Thread history query failed:", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
