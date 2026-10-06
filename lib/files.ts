import type { RowDataPacket, ResultSetHeader } from "mysql2";
import crypto from "node:crypto";
import { getDb } from "./db";

// File repo on the Docs tab. Storage backend is MySQL LONGBLOB — the same
// platform that hosts everything else. Designed for "temporary safe keeping"
// of working files (PDFs, screenshots, briefings, etc.); a 30 MB per-file
// cap covers the common cases and a 250 MB aggregate cap keeps the table
// from ballooning. If we ever outgrow it we can swap the backend without
// changing the user-facing surface.

export const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;
export const MAX_TOTAL_SIZE_BYTES = 250 * 1024 * 1024;

export interface FileSummary {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  tags: string[];
  docId: string | null;
  uploadedAt: string;
}

export interface FileFull extends FileSummary {
  data: Buffer;
}

export interface QuotaUsage {
  usedBytes: number;
  limitBytes: number;
  count: number;
}

interface FileRow extends RowDataPacket {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  description: string | null;
  tags: string[] | null;
  doc_id: string | null;
  uploaded_at: Date;
}

interface FileRowWithData extends FileRow { data: Buffer }

function asTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, 20);
}

function summaryRow(r: FileRow): FileSummary {
  return {
    id: r.id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    description: r.description,
    tags: asTags(r.tags),
    docId: r.doc_id,
    uploadedAt: r.uploaded_at.toISOString(),
  };
}

export async function listFiles(opts: { docId?: string } = {}): Promise<FileSummary[]> {
  const pool = await getDb();
  const params: (string | number)[] = [];
  let where = "";
  if (opts.docId) { where = "WHERE doc_id = ?"; params.push(opts.docId); }
  const [rows] = await pool.query<FileRow[]>(
    // Deliberately omit `data` here — listing should never ship blob bodies.
    `SELECT id, filename, mime_type, size_bytes, description, tags, doc_id, uploaded_at
     FROM files ${where}
     ORDER BY uploaded_at DESC`,
    params
  );
  return rows.map(summaryRow);
}

export async function getFileSummary(id: string): Promise<FileSummary | null> {
  const pool = await getDb();
  const [rows] = await pool.query<FileRow[]>(
    "SELECT id, filename, mime_type, size_bytes, description, tags, doc_id, uploaded_at FROM files WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? summaryRow(rows[0]) : null;
}

// Pulls bytes — only call from the download / inline-serve routes.
export async function getFileWithData(id: string): Promise<FileFull | null> {
  const pool = await getDb();
  const [rows] = await pool.query<FileRowWithData[]>(
    "SELECT id, filename, mime_type, size_bytes, description, tags, doc_id, uploaded_at, data FROM files WHERE id = ?",
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...summaryRow(r), data: r.data };
}

export async function createFile(input: {
  filename: string;
  mimeType: string;
  data: Buffer;
  description?: string;
  tags?: string[];
  docId?: string;
}): Promise<FileSummary> {
  const id = crypto.randomUUID();
  const now = new Date();
  const sanitizedFilename = input.filename.slice(0, 255) || "untitled";
  const sanitizedMime = input.mimeType.slice(0, 127) || "application/octet-stream";
  const tags = asTags(input.tags);
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO files (id, filename, mime_type, size_bytes, description, tags, doc_id, data, uploaded_at)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)`,
    [
      id,
      sanitizedFilename,
      sanitizedMime,
      input.data.length,
      input.description?.slice(0, 2000) ?? null,
      JSON.stringify(tags),
      input.docId ?? null,
      input.data,
      now,
    ]
  );
  return {
    id,
    filename: sanitizedFilename,
    mimeType: sanitizedMime,
    sizeBytes: input.data.length,
    description: input.description ?? null,
    tags,
    docId: input.docId ?? null,
    uploadedAt: now.toISOString(),
  };
}

export async function updateFileMetadata(id: string, patch: {
  filename?: string;
  description?: string | null;
  tags?: string[];
  docId?: string | null;
}): Promise<FileSummary | null> {
  const existing = await getFileSummary(id);
  if (!existing) return null;
  const next = {
    filename: patch.filename !== undefined ? patch.filename.slice(0, 255) || "untitled" : existing.filename,
    description: patch.description !== undefined ? (patch.description === null ? null : patch.description.slice(0, 2000)) : existing.description,
    tags: patch.tags !== undefined ? asTags(patch.tags) : existing.tags,
    docId: patch.docId !== undefined ? patch.docId : existing.docId,
  };
  const pool = await getDb();
  await pool.execute(
    `UPDATE files SET filename = ?, description = ?, tags = CAST(? AS JSON), doc_id = ? WHERE id = ?`,
    [next.filename, next.description, JSON.stringify(next.tags), next.docId, id]
  );
  return { ...existing, ...next };
}

export async function deleteFile(id: string): Promise<boolean> {
  const pool = await getDb();
  const [res] = await pool.execute<ResultSetHeader>("DELETE FROM files WHERE id = ?", [id]);
  return res.affectedRows > 0;
}

export async function getQuotaUsage(): Promise<QuotaUsage> {
  const pool = await getDb();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(size_bytes), 0) AS used, COUNT(*) AS cnt FROM files"
  );
  return {
    usedBytes: Number(rows[0]?.used ?? 0),
    limitBytes: MAX_TOTAL_SIZE_BYTES,
    count: Number(rows[0]?.cnt ?? 0),
  };
}

// ─── Bulk (the Files pane's multi-select bar, REVIEW-2026-10 D3) ────────────

const MAX_BULK = 500;
const idList = (ids: string[]) => [...new Set(ids.filter((x) => typeof x === "string" && x.length > 0))].slice(0, MAX_BULK);

export async function bulkFileTag(ids: string[], tag: string, add: boolean): Promise<{ affected: number }> {
  const list = idList(ids);
  const t = tag.trim().slice(0, 64);
  if (!list.length || !t) return { affected: 0 };
  const pool = await getDb();
  const [rows] = await pool.query<FileRow[]>("SELECT id, filename, mime_type, size_bytes, description, tags, doc_id, uploaded_at FROM files WHERE id IN (?)", [list]);
  let affected = 0;
  for (const r of rows) {
    const have = asTags(r.tags);
    const next = add ? (have.includes(t) ? null : [...have, t].slice(0, 20)) : (have.includes(t) ? have.filter((x) => x !== t) : null);
    if (!next) continue;
    await pool.execute("UPDATE files SET tags = CAST(? AS JSON) WHERE id = ?", [JSON.stringify(next), r.id]);
    affected++;
  }
  return { affected };
}

export async function bulkFileAttach(ids: string[], docId: string | null): Promise<{ affected: number }> {
  const list = idList(ids);
  if (!list.length) return { affected: 0 };
  const pool = await getDb();
  const [res] = await pool.query<ResultSetHeader>("UPDATE files SET doc_id = ? WHERE id IN (?)", [docId, list]);
  return { affected: res.affectedRows };
}

export async function bulkFileDelete(ids: string[]): Promise<{ affected: number }> {
  const list = idList(ids);
  if (!list.length) return { affected: 0 };
  const pool = await getDb();
  const [res] = await pool.query<ResultSetHeader>("DELETE FROM files WHERE id IN (?)", [list]);
  return { affected: res.affectedRows };
}

/** Bytes for a zip download — bounded by the aggregate quota, so at most ~250 MB. */
export async function getFilesWithData(ids: string[]): Promise<FileFull[]> {
  const list = idList(ids);
  if (!list.length) return [];
  const pool = await getDb();
  const [rows] = await pool.query<FileRowWithData[]>(
    "SELECT id, filename, mime_type, size_bytes, description, tags, doc_id, uploaded_at, data FROM files WHERE id IN (?) ORDER BY uploaded_at DESC",
    [list]
  );
  return rows.map((r) => ({ ...summaryRow(r), data: r.data }));
}
