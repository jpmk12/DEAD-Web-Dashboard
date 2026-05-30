import type { RowDataPacket, ResultSetHeader } from "mysql2";
import crypto from "node:crypto";
import { getDb } from "./db";

export interface DocumentSummary {
  id: string;
  title: string;
  tags: string[];
  pinned: boolean;
  updatedAt: string;
  snippet?: string;       // populated by search results
}

export interface DocumentFull extends DocumentSummary {
  content: string;
  createdAt: string;
}

export type LinkTargetType = "doc" | "article" | "email" | "event";

export interface DocumentLink {
  docId: string;
  targetType: LinkTargetType;
  targetId: string;
  targetTitle: string | null;
}

interface DocRow extends RowDataPacket {
  id: string;
  title: string;
  content: string;
  tags: string[] | null;
  pinned: number;
  created_at: Date;
  updated_at: Date;
}

interface LinkRow extends RowDataPacket {
  doc_id: string;
  target_type: string;
  target_id: string;
  target_title: string | null;
}

function asTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, 20);
}

function summary(r: DocRow): DocumentSummary {
  return {
    id: r.id,
    title: r.title,
    tags: asTags(r.tags),
    pinned: Boolean(r.pinned),
    updatedAt: r.updated_at.toISOString(),
  };
}

function full(r: DocRow): DocumentFull {
  return {
    ...summary(r),
    content: r.content ?? "",
    createdAt: r.created_at.toISOString(),
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function listDocuments({
  search,
  tag,
  pinnedOnly,
  limit = 100,
}: { search?: string; tag?: string; pinnedOnly?: boolean; limit?: number } = {}): Promise<DocumentSummary[]> {
  const pool = await getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];

  // Use FULLTEXT in NATURAL LANGUAGE mode when a real query is provided
  // (≥3 chars). Otherwise fall back to a LIKE on title for short queries.
  let scoreSelect = "";
  let order = "pinned DESC, updated_at DESC";
  if (search) {
    const trimmed = search.trim();
    if (trimmed.length >= 3) {
      scoreSelect = ", MATCH(title, content) AGAINST(? IN NATURAL LANGUAGE MODE) AS score";
      params.push(trimmed);
      where.push("MATCH(title, content) AGAINST(? IN NATURAL LANGUAGE MODE)");
      params.push(trimmed);
      order = "pinned DESC, score DESC, updated_at DESC";
    } else {
      where.push("LOWER(title) LIKE ?");
      params.push(`%${trimmed.toLowerCase()}%`);
    }
  }
  if (tag) {
    where.push("JSON_CONTAINS(tags, JSON_QUOTE(?), '$')");
    params.push(tag);
  }
  if (pinnedOnly) where.push("pinned = 1");

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  params.push(limit);

  const [rows] = await pool.query<DocRow[]>(
    `SELECT id, title, content, tags, pinned, created_at, updated_at${scoreSelect}
     FROM documents
     ${whereSql}
     ORDER BY ${order}
     LIMIT ?`,
    params
  );

  return rows.map((r) => {
    const s = summary(r);
    // Build a small snippet for search results: first 160 chars after the
    // search term in the content.
    if (search && r.content) {
      const idx = r.content.toLowerCase().indexOf(search.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 30);
        s.snippet = (start > 0 ? "…" : "") + r.content.slice(start, start + 160).trim();
      } else {
        s.snippet = r.content.slice(0, 160).trim();
      }
    }
    return s;
  });
}

export async function getDocument(id: string): Promise<DocumentFull | null> {
  const pool = await getDb();
  const [rows] = await pool.query<DocRow[]>(
    "SELECT id, title, content, tags, pinned, created_at, updated_at FROM documents WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? full(rows[0]) : null;
}

export async function createDocument(input: { title: string; content?: string; tags?: string[] }): Promise<DocumentFull> {
  const id = crypto.randomUUID();
  const now = new Date();
  const title = input.title.trim().slice(0, 255) || "Untitled";
  const content = (input.content ?? "").slice(0, 200_000);
  const tags = asTags(input.tags);
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO documents (id, title, content, tags, pinned, created_at, updated_at)
     VALUES (?, ?, ?, CAST(? AS JSON), 0, ?, ?)`,
    [id, title, content, JSON.stringify(tags), now, now]
  );
  await rebuildLinksForDoc(id, content);
  return {
    id, title, content, tags, pinned: false,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
}

export async function updateDocument(id: string, patch: { title?: string; content?: string; tags?: string[]; pinned?: boolean }): Promise<DocumentFull | null> {
  const existing = await getDocument(id);
  if (!existing) return null;
  const next = {
    title: patch.title !== undefined ? patch.title.trim().slice(0, 255) || "Untitled" : existing.title,
    content: patch.content !== undefined ? patch.content.slice(0, 200_000) : existing.content,
    tags: patch.tags !== undefined ? asTags(patch.tags) : existing.tags,
    pinned: patch.pinned !== undefined ? patch.pinned : existing.pinned,
  };
  const now = new Date();
  const pool = await getDb();
  await pool.execute(
    `UPDATE documents SET title = ?, content = ?, tags = CAST(? AS JSON), pinned = ?, updated_at = ?
     WHERE id = ?`,
    [next.title, next.content, JSON.stringify(next.tags), next.pinned ? 1 : 0, now, id]
  );
  if (patch.content !== undefined) {
    // Re-fetch the row after the UPDATE so the link rebuild reflects the
    // last-write-wins state of the DB rather than the value we computed from
    // a possibly-stale SELECT. Concurrent debounced PATCHes against the same
    // doc would otherwise leave document_links pointing at the loser's [[x]]
    // markers while the body shows the winner's content.
    const fresh = await getDocument(id);
    if (fresh) await rebuildLinksForDoc(id, fresh.content);
  }
  return { ...existing, ...next, updatedAt: now.toISOString() };
}

export async function deleteDocument(id: string): Promise<boolean> {
  const pool = await getDb();
  // FK on document_links cascades automatically.
  const [res] = await pool.execute<ResultSetHeader>("DELETE FROM documents WHERE id = ?", [id]);
  return res.affectedRows > 0;
}

// ─── Link extraction (wiki-style [[Doc Title]]) ──────────────────────────────

const WIKI_LINK_RE = /\[\[([^\[\]\n]{1,200})\]\]/g;

export function extractWikiLinks(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(WIKI_LINK_RE)) {
    const t = m[1].trim();
    if (t) out.add(t);
  }
  return [...out];
}

// Re-scan the doc's content, drop any existing doc-target edges from it, and
// re-create them based on the [[Doc Title]] markers currently present. Other
// link kinds (article/email/event) are inserted by the call sites that create
// docs via "Save to notes" and are NOT touched here.
async function rebuildLinksForDoc(docId: string, content: string): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM document_links WHERE doc_id = ? AND target_type = 'doc'", [docId]);

  const titles = extractWikiLinks(content);
  if (titles.length === 0) return;

  // Resolve linked titles to existing doc ids (case-insensitive).
  const [matchRows] = await pool.query<DocRow[]>(
    `SELECT id, title FROM documents
     WHERE LOWER(title) IN (?)`,
    [titles.map((t) => t.toLowerCase())]
  );
  if (matchRows.length === 0) return;

  // Bulk insert. ON DUPLICATE KEY ignores re-adds.
  const placeholders = matchRows.map(() => "(?, 'doc', ?, ?)").join(",");
  const params: string[] = [];
  for (const r of matchRows) {
    params.push(docId, r.id, r.title);
  }
  await pool.query(
    `INSERT INTO document_links (doc_id, target_type, target_id, target_title)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE target_title = VALUES(target_title)`,
    params
  );
}

// Insert a single edge from a doc to an external target (article / email / event).
export async function recordExternalLink(docId: string, type: LinkTargetType, targetId: string, targetTitle?: string): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO document_links (doc_id, target_type, target_id, target_title)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE target_title = VALUES(target_title)`,
    [docId, type, targetId.slice(0, 255), targetTitle?.slice(0, 1000) ?? null]
  );
}

// ─── Backlinks ───────────────────────────────────────────────────────────────

// "What docs reference this target?" For doc → doc, the targetType is 'doc'
// and targetId is a UUID; for an article, it's the article id; etc.
export async function getBacklinks(targetType: LinkTargetType, targetId: string): Promise<DocumentSummary[]> {
  const pool = await getDb();
  const [rows] = await pool.query<DocRow[]>(
    `SELECT d.id, d.title, d.content, d.tags, d.pinned, d.created_at, d.updated_at
     FROM document_links dl
     JOIN documents d ON d.id = dl.doc_id
     WHERE dl.target_type = ? AND dl.target_id = ?
     ORDER BY d.updated_at DESC
     LIMIT 50`,
    [targetType, targetId]
  );
  return rows.map(summary);
}

// Outbound links from a single doc (for display alongside the editor).
export async function getOutboundLinks(docId: string): Promise<DocumentLink[]> {
  const pool = await getDb();
  const [rows] = await pool.query<LinkRow[]>(
    "SELECT doc_id, target_type, target_id, target_title FROM document_links WHERE doc_id = ?",
    [docId]
  );
  return rows.map((r) => ({
    docId: r.doc_id,
    targetType: r.target_type as LinkTargetType,
    targetId: r.target_id,
    targetTitle: r.target_title,
  }));
}

// Most-recently-updated N docs — used by the chat route to surface recent
// notes as additional context.
export async function getRecentDocsForContext(n: number = 5): Promise<DocumentFull[]> {
  const pool = await getDb();
  const [rows] = await pool.query<DocRow[]>(
    "SELECT id, title, content, tags, pinned, created_at, updated_at FROM documents ORDER BY updated_at DESC LIMIT ?",
    [n]
  );
  return rows.map(full);
}

// ─── Tag manager ─────────────────────────────────────────────────────────────
//
// Read-aggregate across all docs to support the Manage Tags modal in the
// Docs sidebar. At a typical user's scale (<1k docs, <100 tags) this is
// fast enough to run on every modal open without needing a separate
// aggregate table. If the doc count balloons later, swap to a denormalised
// tag_counts table maintained by save / delete.

interface TagsOnlyRow extends RowDataPacket { tags: unknown }

export async function listAllTags(): Promise<{ tag: string; count: number }[]> {
  const pool = await getDb();
  const [rows] = await pool.query<TagsOnlyRow[]>("SELECT tags FROM documents");
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!Array.isArray(row.tags)) continue;
    const seen = new Set<string>();
    for (const t of row.tags) {
      if (typeof t !== "string") continue;
      const k = t.trim();
      if (!k || seen.has(k)) continue; // de-dupe within a single doc
      seen.add(k);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// Replace `from` with `to` on every doc that has it (rename / merge), or
// remove `from` entirely if `to` is null (delete). De-duplicates within
// each doc so a merge of "china" into "China" on a doc that already has
// both ends up with just "China". Runs as a single transaction so a
// half-applied state can't leak out under contention.
export async function updateTagAcrossDocs(from: string, to: string | null): Promise<{ docsAffected: number }> {
  const pool = await getDb();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>("SELECT id, tags FROM documents");
    let affected = 0;
    const now = new Date();
    for (const row of rows) {
      if (!Array.isArray(row.tags)) continue;
      const arr = (row.tags as unknown[]).filter((t): t is string => typeof t === "string");
      if (!arr.includes(from)) continue;
      let next: string[];
      if (to) {
        const seen = new Set<string>();
        next = [];
        for (const t of arr) {
          const replaced = t === from ? to : t;
          if (seen.has(replaced)) continue;
          seen.add(replaced);
          next.push(replaced);
        }
      } else {
        next = arr.filter((t) => t !== from);
      }
      await conn.execute(
        "UPDATE documents SET tags = CAST(? AS JSON), updated_at = ? WHERE id = ?",
        [JSON.stringify(next), now, row.id]
      );
      affected++;
    }
    await conn.commit();
    return { docsAffected: affected };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
