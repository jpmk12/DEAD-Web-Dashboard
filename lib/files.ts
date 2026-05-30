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
