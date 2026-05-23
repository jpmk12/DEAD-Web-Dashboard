import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listTasks, createTask, patchTask, deleteTask } from "@/lib/googleTasks";
import { GoogleTask } from "@/lib/types";

function isCredentialError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: number; status?: number; message?: string };
  if (e.code === 401 || e.status === 401) return true;
  const msg = e.message ?? "";
  return /insufficient.*scope|forbidden|PERMISSION_DENIED|invalid.credentials/i.test(msg);
}

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const tasks = await listTasks(session.accessToken as string);
    return NextResponse.json({ tasks });
  } catch (err) {
    if (isCredentialError(err)) return NextResponse.json({ error: "reauth_required" }, { status: 403 });
    console.error("Tasks list failed:", err);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { title, due, notes } = body as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  try {
    const task = await createTask(
      session.accessToken as string,
      title.slice(0, 200),
      typeof due === "string" && due ? due : undefined,
      typeof notes === "string" && notes ? notes.slice(0, 1000) : undefined
    );
    return NextResponse.json({ task });
  } catch (err) {
    console.error("Task create failed:", err);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { id, status, title, due, notes } = body as Record<string, unknown>;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const patch: Parameters<typeof patchTask>[2] = {};
  if (status === "needsAction" || status === "completed") patch.status = status;
  if (typeof title === "string") patch.title = title.slice(0, 200);
  if (due === null) patch.due = null;
  else if (typeof due === "string") patch.due = due;
  if (typeof notes === "string") patch.notes = notes.slice(0, 1000);

  try {
    const task = await patchTask(session.accessToken as string, id, patch);
    return NextResponse.json({ task });
  } catch (err) {
    console.error("Task patch failed:", err);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    await deleteTask(session.accessToken as string, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Task delete failed:", err);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
