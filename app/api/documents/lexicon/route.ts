import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLexicon } from "@/lib/documents";
import { termDefinition } from "@/lib/threadTrace";

export const dynamic = "force-dynamic";

// GET /api/documents/lexicon — every ≔ term doc as a glossary entry:
// first-paragraph definition, props, link count, and owner (explicit
// props.owner wins; otherwise the term's most-linked theorist).
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entries = await getLexicon(termDefinition);
  return NextResponse.json({ entries });
}
