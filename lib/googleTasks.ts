import { tasks as tasksApi, tasks_v1 } from "@googleapis/tasks";
import { OAuth2Client } from "google-auth-library";
import { GoogleTask } from "./types";

function normalize(t: tasks_v1.Schema$Task): GoogleTask {
  return {
    id: t.id ?? "",
    title: t.title ?? "",
    status: t.status === "completed" ? "completed" : "needsAction",
    due: t.due ?? undefined,
    notes: t.notes ?? undefined,
    completed: t.completed ?? undefined,
    updated: t.updated ?? new Date().toISOString(),
  };
}

function makeClient(accessToken: string) {
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  return tasksApi({ version: "v1", auth });
}

export async function listTasks(accessToken: string): Promise<GoogleTask[]> {
  const client = makeClient(accessToken);
  const res = await client.tasks.list({
    tasklist: "@default",
    maxResults: 100,
    showCompleted: false,
    showHidden: false,
  });
  return (res.data.items ?? []).map(normalize);
}

export async function createTask(
  accessToken: string,
  title: string,
  due?: string,
  notes?: string
): Promise<GoogleTask> {
  const client = makeClient(accessToken);
  // Google Tasks requires RFC 3339 with midnight UTC for due dates
  const dueRfc = due
    ? due.includes("T")
      ? due
      : `${due}T00:00:00.000Z`
    : undefined;

  const res = await client.tasks.insert({
    tasklist: "@default",
    requestBody: {
      title,
      ...(dueRfc ? { due: dueRfc } : {}),
      ...(notes ? { notes } : {}),
    },
  });
  return normalize(res.data);
}

export async function patchTask(
  accessToken: string,
  id: string,
  patch: { status?: GoogleTask["status"]; title?: string; due?: string | null; notes?: string }
): Promise<GoogleTask> {
  const client = makeClient(accessToken);
  const requestBody: tasks_v1.Schema$Task = {};
  if (patch.status !== undefined) requestBody.status = patch.status;
  if (patch.title !== undefined) requestBody.title = patch.title;
  if (patch.due !== undefined)
    requestBody.due = patch.due
      ? patch.due.includes("T")
        ? patch.due
        : `${patch.due}T00:00:00.000Z`
      : undefined;
  if (patch.notes !== undefined) requestBody.notes = patch.notes;

  const res = await client.tasks.patch({ tasklist: "@default", task: id, requestBody });
  return normalize(res.data);
}

export async function deleteTask(accessToken: string, id: string): Promise<void> {
  const client = makeClient(accessToken);
  await client.tasks.delete({ tasklist: "@default", task: id });
}
