import { NextResponse } from "next/server";
import { normEmail } from "@/lib/allowlist";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { todayInTz } from "@/lib/date";
import { createEvent } from "@/lib/calendar";
import { listContacts, createContact, updateContact, deleteContact, contactStatus, sortByDue } from "@/lib/contacts";

export const dynamic = "force-dynamic";

// Keep-in-touch roster.
//   GET    → { contacts: [{ ...contact, status }], today }  (urgency-ordered)
//   POST   → create { name, email?, cadenceDays?, tier?, notes? }
//   PATCH  → { id, action:"contacted" } | { id, action:"schedule", when? } | { id, ...fields }
//   DELETE → ?id=

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prefs = await getUserPrefs(normEmail(session.user?.email)).catch(() => null);
  const today = todayInTz(prefs?.timezone || "America/Chicago");
  const contacts = await listContacts(normEmail(session.user?.email)).catch(() => []);
  const ordered = sortByDue(contacts, today).map((c) => ({ ...c, status: contactStatus(c, today) }));
  return NextResponse.json({ contacts: ordered, today });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { name?: unknown; email?: unknown; cadenceDays?: unknown; tier?: unknown; notes?: unknown } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const name = String(body.name ?? "").trim().slice(0, 160);
  if (!name) return NextResponse.json({ error: "A name is required" }, { status: 400 });
  const email = body.email ? String(body.email).trim().slice(0, 254) : null;
  const cadenceDays = Number.isFinite(Number(body.cadenceDays)) ? Number(body.cadenceDays) : 90;
  const contact = await createContact(normEmail(session.user?.email), { name, email, cadenceDays, tier: body.tier ? String(body.tier).slice(0, 24) : null, notes: body.notes ? String(body.notes).slice(0, 1000) : null });
  return NextResponse.json({ ok: true, contact });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const prefs = await getUserPrefs(normEmail(session.user?.email)).catch(() => null);
  const tz = prefs?.timezone || "America/Chicago";

  if (body.action === "contacted") {
    await updateContact(normEmail(session.user?.email), id, { lastContacted: todayInTz(tz) });
    return NextResponse.json({ ok: true });
  }

  // Drop a real calendar event for this check-in (the "hybrid: on-demand event"
  // path). Honors a user-picked `when` (naive local "YYYY-MM-DDThh:mm"); falls
  // back to tomorrow 09:00 local. Always 15 minutes; does NOT mark contacted.
  if (body.action === "schedule") {
    const contacts = await listContacts(normEmail(session.user?.email)).catch(() => []);
    const c = contacts.find((x) => x.id === id);
    if (!c) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    let start: string;
    if (typeof body.when === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(body.when)) {
      start = body.when.length === 16 ? `${body.when}:00` : body.when;
    } else {
      const day = todayInTz(tz);
      const tomorrow = new Date(`${day}T00:00:00Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      start = `${tomorrow.toISOString().slice(0, 10)}T09:00:00`;
    }
    // +15 min, computed on the naive wall-clock string (treat as UTC purely for
    // the arithmetic; the real zone is carried by `timeZone`).
    const endD = new Date(`${start}Z`);
    endD.setUTCMinutes(endD.getUTCMinutes() + 15);
    const end = endD.toISOString().slice(0, 19);
    try {
      const ev = await createEvent(session.accessToken as string, {
        summary: `Check in with ${c.name}`,
        start,
        end,
        description: [c.notes ? `Notes: ${c.notes}` : "", c.lastContacted ? `Last contacted: ${c.lastContacted}` : "First check-in.", "— scheduled from Keep in Touch"].filter(Boolean).join("\n"),
        location: c.email ?? undefined,
        timeZone: tz,
      });
      return NextResponse.json({ ok: true, event: { title: ev.title, start: ev.start } });
    } catch (err) {
      console.error("[contacts] schedule failed:", err);
      return NextResponse.json({ error: "Couldn't create the calendar event" }, { status: 502 });
    }
  }

  // Field edit.
  await updateContact(normEmail(session.user?.email), id, {
    name: body.name !== undefined ? String(body.name).slice(0, 160) : undefined,
    email: body.email !== undefined ? (body.email ? String(body.email).slice(0, 254) : null) : undefined,
    cadenceDays: body.cadenceDays !== undefined ? Number(body.cadenceDays) : undefined,
    notes: body.notes !== undefined ? (body.notes ? String(body.notes).slice(0, 1000) : null) : undefined,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteContact(normEmail(session.user?.email), id);
  return NextResponse.json({ ok: true });
}
