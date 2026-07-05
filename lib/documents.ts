import type { RowDataPacket, ResultSetHeader } from "mysql2";
import crypto from "node:crypto";
import { getDb } from "./db";
import { extractWikiLinkRefs } from "./linkRelations";
import { snippetAround } from "./docMentions";

export interface DocumentSummary {
  id: string;
  title: string;
  tags: string[];
  // Alternate names this doc answers to — [[alias]] resolves here and the
  // unlinked-mentions scanner matches on them.
  aliases: string[];
  // One-level grouping in the sidebar; null = "No collection".
  collection: string | null;
  // Entity kind (lib/docTypes.ts vocabulary); drives icon + type filter.
  docType: string;
  // Free key:value properties (era, course, domain, …) — filterable via
  // key:value tokens in the sidebar search.
  props: Record<string, string>;
  pinned: boolean;
  archived: boolean;
  updatedAt: string;
  // Approximate word count derived from content character length / 5. Lets
  // the sidebar offer a "Longest first" sort without pulling content into
  // the listing response.
  wordCount: number;
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
  // Typed wiki-link metadata from [[Title | relation: note]]. Re-derived from
  // the doc text on every save; null for plain links and external targets.
  relation: string | null;
  note: string | null;
}

// Backlink row for the editor footer: who links here, HOW (relation/note),
// and the sentence around the link so the connection is legible in place.
export interface BacklinkEntry extends DocumentSummary {
  relation: string | null;
  note: string | null;
  linkSnippet: string | null;
}

interface DocRow extends RowDataPacket {
  id: string;
  title: string;
  content: string;
  tags: string[] | null;
  aliases?: string[] | null;
  collection?: string | null;
  doc_type?: string | null;
  props?: Record<string, unknown> | null;
  pinned: number;
  archived?: number;
  // Populated by listDocuments via CHAR_LENGTH(content) so we don't pay
  // the cost of shipping content for every row.
  char_count?: number;
  created_at: Date;
  updated_at: Date;
}

interface LinkRow extends RowDataPacket {
  doc_id: string;
  target_type: string;
  target_id: string;
  target_title: string | null;
  relation?: string | null;
  note?: string | null;
}

function asTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, 20);
}

// Sanitise a props object: string keys/values only, capped counts + lengths.
function asProps(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = k.trim().slice(0, 40);
    if (!key) continue;
    if (typeof val !== "string" && typeof val !== "number") continue;
    out[key] = String(val).slice(0, 200);
    if (Object.keys(out).length >= 20) break;
  }
  return out;
}

function asCollection(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().slice(0, 64);
  return c || null;
}

function summary(r: DocRow): DocumentSummary {
  // Word count = char_count / 5. Rough but good enough for sort + the
  // editor-footer estimate. Computed from CHAR_LENGTH selected in
  // listDocuments so we don't ship the full content for every row.
  const chars = typeof r.char_count === "number" ? r.char_count : (r.content ? r.content.length : 0);
  return {
    id: r.id,
    title: r.title,
    tags: asTags(r.tags),
    aliases: asTags(r.aliases),
    collection: r.collection ?? null,
    docType: r.doc_type || "note",
    props: asProps(r.props),
    pinned: Boolean(r.pinned),
    archived: Boolean(r.archived),
    updatedAt: r.updated_at.toISOString(),
    wordCount: Math.round(chars / 5),
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
  archived = false,
  limit = 100,
}: { search?: string; tag?: string; pinnedOnly?: boolean; archived?: boolean; limit?: number } = {}): Promise<DocumentSummary[]> {
  const pool = await getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];

  // Default: only active docs. Pass archived:true to get just the archive.
  // No mixed view — archived = false hides archived rows; archived = true
  // shows only archived rows. The sidebar's "Archived" smart view drives
  // the latter.
  where.push(archived ? "archived = 1" : "archived = 0");

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
    `SELECT id, title, content, tags, aliases, collection, doc_type, props, pinned, archived, created_at, updated_at,
            CHAR_LENGTH(content) AS char_count${scoreSelect}
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
    "SELECT id, title, content, tags, aliases, collection, doc_type, props, pinned, archived, created_at, updated_at FROM documents WHERE id = ?",

    [id]
  );
  return rows.length > 0 ? full(rows[0]) : null;
}

export async function createDocument(input: {
  title: string; content?: string; tags?: string[]; aliases?: string[];
  collection?: string | null; docType?: string; props?: Record<string, string>;
}): Promise<DocumentFull> {
  const id = crypto.randomUUID();
  const now = new Date();
  const title = input.title.trim().slice(0, 255) || "Untitled";
  const content = (input.content ?? "").slice(0, 200_000);
  const tags = asTags(input.tags);
  const aliases = asTags(input.aliases);
  const collection = asCollection(input.collection);
  const docType = (input.docType ?? "note").slice(0, 16);
  const props = asProps(input.props);
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO documents (id, title, content, tags, aliases, collection, doc_type, props, pinned, created_at, updated_at)
     VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, CAST(? AS JSON), 0, ?, ?)`,
    [id, title, content, JSON.stringify(tags), JSON.stringify(aliases), collection, docType, JSON.stringify(props), now, now]
  );
  await rebuildLinksForDoc(id, content);
  return {
    id, title, content, tags, aliases, collection, docType, props, pinned: false, archived: false,
    wordCount: Math.round(content.length / 5),
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
}

export async function updateDocument(id: string, patch: {
  title?: string; content?: string; tags?: string[]; aliases?: string[];
  collection?: string | null; docType?: string; props?: Record<string, string>;
  pinned?: boolean; archived?: boolean;
}): Promise<DocumentFull | null> {
  const existing = await getDocument(id);
  if (!existing) return null;
  const next = {
    title: patch.title !== undefined ? patch.title.trim().slice(0, 255) || "Untitled" : existing.title,
    content: patch.content !== undefined ? patch.content.slice(0, 200_000) : existing.content,
    tags: patch.tags !== undefined ? asTags(patch.tags) : existing.tags,
    aliases: patch.aliases !== undefined ? asTags(patch.aliases) : existing.aliases,
    // collection: null clears it; undefined leaves it alone.
    collection: patch.collection !== undefined ? asCollection(patch.collection) : existing.collection,
    docType: patch.docType !== undefined ? patch.docType.slice(0, 16) : existing.docType,
    props: patch.props !== undefined ? asProps(patch.props) : existing.props,
    pinned: patch.pinned !== undefined ? patch.pinned : existing.pinned,
  };
  // Snapshot the OLD state to document_versions before applying the patch —
  // only when content actually changes (otherwise the autosave path of
  // pin/unpin/tag edits would burn versions for no reason). The throttle
  // inside maybeSnapshotVersion keeps a rapid edit cluster to one snapshot.
  if (patch.content !== undefined && existing.content !== next.content) {
    await maybeSnapshotVersion(existing);
  }
  const now = new Date();
  const pool = await getDb();
  // archived is updated only when explicitly present in the patch — a normal
  // PATCH that just bumps title or content shouldn't restore an archived doc.
  if (patch.archived !== undefined) {
    await pool.execute(
      `UPDATE documents SET title = ?, content = ?, tags = CAST(? AS JSON), aliases = CAST(? AS JSON), collection = ?, doc_type = ?, props = CAST(? AS JSON), pinned = ?, archived = ?, updated_at = ?
       WHERE id = ?`,
      [next.title, next.content, JSON.stringify(next.tags), JSON.stringify(next.aliases), next.collection, next.docType, JSON.stringify(next.props), next.pinned ? 1 : 0, patch.archived ? 1 : 0, now, id]
    );
  } else {
    await pool.execute(
      `UPDATE documents SET title = ?, content = ?, tags = CAST(? AS JSON), aliases = CAST(? AS JSON), collection = ?, doc_type = ?, props = CAST(? AS JSON), pinned = ?, updated_at = ?
       WHERE id = ?`,
      [next.title, next.content, JSON.stringify(next.tags), JSON.stringify(next.aliases), next.collection, next.docType, JSON.stringify(next.props), next.pinned ? 1 : 0, now, id]
    );
  }
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


// Distinct link target titles (pipe segments stripped) — kept for callers
// that only care about WHAT is linked, not how.
export function extractWikiLinks(content: string): string[] {
  return [...new Set(extractWikiLinkRefs(content).map((r) => r.title))];
}

// Re-scan the doc's content, drop any existing doc-target edges from it, and
// re-create them based on the [[Doc Title | relation: note]] markers currently
// present. Titles resolve case-insensitively against doc titles AND aliases
// (title match wins over alias). Other link kinds (article/email/event) are
// inserted by the call sites that create docs via "Save to notes" and are NOT
// touched here.
async function rebuildLinksForDoc(docId: string, content: string): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM document_links WHERE doc_id = ? AND target_type = 'doc'", [docId]);

  const refs = extractWikiLinkRefs(content);
  if (refs.length === 0) return;
  const names = [...new Set(refs.map((r) => r.title.toLowerCase()))];

  // One query pulls exact-title matches plus every alias-carrying doc; alias
  // matching happens in JS because MySQL JSON functions are case-sensitive.
  // Alias-carrying docs are expected to stay a small subset.
  const [matchRows] = await pool.query<DocRow[]>(
    `SELECT id, title, aliases FROM documents
     WHERE LOWER(title) IN (?) OR aliases IS NOT NULL`,
    [names]
  );
  const byName = new Map<string, { id: string; title: string }>();
  for (const r of matchRows) {
    const key = r.title.toLowerCase();
    if (names.includes(key) && !byName.has(key)) byName.set(key, { id: r.id, title: r.title });
  }
  for (const r of matchRows) {
    for (const a of asTags(r.aliases)) {
      const key = a.trim().toLowerCase();
      if (key && names.includes(key) && !byName.has(key)) byName.set(key, { id: r.id, title: r.title });
    }
  }
  if (byName.size === 0) return;

  // One edge per target doc. When the same target is linked several times,
  // a typed/annotated reference beats a plain one; otherwise first wins.
  const perTarget = new Map<string, { targetId: string; targetTitle: string; relation: string | null; note: string | null }>();
  for (const ref of refs) {
    const hit = byName.get(ref.title.toLowerCase());
    if (!hit) continue;
    const existing = perTarget.get(hit.id);
    const candidate = {
      targetId: hit.id,
      targetTitle: hit.title,
      relation: ref.relation,
      note: ref.note ? ref.note.slice(0, 500) : null,
    };
    if (!existing || (!existing.relation && !existing.note && (candidate.relation || candidate.note))) {
      perTarget.set(hit.id, candidate);
    }
  }
  if (perTarget.size === 0) return;

  const edges = [...perTarget.values()];
  const placeholders = edges.map(() => "(?, 'doc', ?, ?, ?, ?)").join(",");
  const params: (string | null)[] = [];
  for (const e of edges) {
    params.push(docId, e.targetId, e.targetTitle, e.relation, e.note);
  }
  await pool.query(
    `INSERT INTO document_links (doc_id, target_type, target_id, target_title, relation, note)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE target_title = VALUES(target_title), relation = VALUES(relation), note = VALUES(note)`,
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
// and targetId is a UUID; for an article, it's the article id; etc. Doc
// backlinks carry the link's relation/note plus the sentence around the
// [[link]] in the source doc, so the footer can show WHY docs connect.
export async function getBacklinks(targetType: LinkTargetType, targetId: string): Promise<BacklinkEntry[]> {
  const pool = await getDb();
  const [rows] = await pool.query<DocRow[]>(
    `SELECT d.id, d.title, d.content, d.tags, d.aliases, d.collection, d.doc_type, d.props, d.pinned, d.created_at, d.updated_at,
            dl.relation AS link_relation, dl.note AS link_note
     FROM document_links dl
     JOIN documents d ON d.id = dl.doc_id
     WHERE dl.target_type = ? AND dl.target_id = ?
     ORDER BY d.updated_at DESC
     LIMIT 50`,
    [targetType, targetId]
  );

  // Names the [[link]] could have used in the source doc: target's title or
  // any of its aliases. Only relevant for doc targets.
  let targetNames: string[] = [];
  if (targetType === "doc") {
    const target = await getDocument(targetId);
    if (target) targetNames = [target.title, ...target.aliases].map((n) => n.toLowerCase()).filter(Boolean);
  }

  return rows.map((r) => {
    let linkSnippet: string | null = null;
    if (r.content && targetNames.length > 0) {
      const lower = r.content.toLowerCase();
      let best = -1;
      let bestLen = 0;
      for (const name of targetNames) {
        const idx = lower.indexOf(`[[${name}`);
        if (idx !== -1 && (best === -1 || idx < best)) { best = idx; bestLen = name.length + 2; }
      }
      if (best !== -1) {
        linkSnippet = snippetAround(r.content, best, bestLen)
          // Strip wiki-link brackets + any | relation: note segment so the
          // snippet reads as prose.
          .replace(/\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]/g, "$1")
          .replace(/\[\[|\]\]/g, "");
      }
    }
    const rel = (r as DocRow & { link_relation?: string | null }).link_relation ?? null;
    const note = (r as DocRow & { link_note?: string | null }).link_note ?? null;
    return { ...summary(r), relation: rel, note, linkSnippet };
  });
}

// Outbound links from a single doc (for display alongside the editor).
export async function getOutboundLinks(docId: string): Promise<DocumentLink[]> {
  const pool = await getDb();
  const [rows] = await pool.query<LinkRow[]>(
    "SELECT doc_id, target_type, target_id, target_title, relation, note FROM document_links WHERE doc_id = ?",
    [docId]
  );
  return rows.map((r) => ({
    docId: r.doc_id,
    targetType: r.target_type as LinkTargetType,
    targetId: r.target_id,
    targetTitle: r.target_title,
    relation: r.relation ?? null,
    note: r.note ?? null,
  }));
}

// Most-recently-updated N docs — used by the chat route to surface recent
// notes as additional context. Archived docs are intentionally excluded so
// soft-deleted notes don't leak back into AI prompts.
export async function getRecentDocsForContext(n: number = 5): Promise<DocumentFull[]> {
  const pool = await getDb();
  const [rows] = await pool.query<DocRow[]>(
    "SELECT id, title, content, tags, aliases, collection, doc_type, props, pinned, archived, created_at, updated_at FROM documents WHERE archived = 0 ORDER BY updated_at DESC LIMIT ?",
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

// ─── Bulk ops over multiple docs ─────────────────────────────────────────────
//
// Single endpoint serves Pin / Unpin / Tag / Untag / Delete on a batch of
// document ids. Tag/untag is per-doc transformation so it runs in a
// transaction; pin/unpin/delete are single SQL statements.

export async function bulkSetPinned(ids: string[], pinned: boolean): Promise<{ affected: number }> {
  if (ids.length === 0) return { affected: 0 };
  const pool = await getDb();
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE documents SET pinned = ?, updated_at = ? WHERE id IN (?)",
    [pinned ? 1 : 0, new Date(), ids]
  );
  return { affected: res.affectedRows };
}

export async function bulkDelete(ids: string[]): Promise<{ affected: number }> {
  if (ids.length === 0) return { affected: 0 };
  const pool = await getDb();
  // document_links FK cascades on delete.
  const [res] = await pool.query<ResultSetHeader>(
    "DELETE FROM documents WHERE id IN (?)",
    [ids]
  );
  return { affected: res.affectedRows };
}

export async function bulkAddTag(ids: string[], tag: string): Promise<{ affected: number }> {
  if (ids.length === 0 || !tag.trim()) return { affected: 0 };
  const trimmed = tag.trim().slice(0, 64);
  const pool = await getDb();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, tags FROM documents WHERE id IN (?)",
      [ids]
    );
    let affected = 0;
    const now = new Date();
    for (const row of rows) {
      const arr = Array.isArray(row.tags)
        ? (row.tags as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
      if (arr.includes(trimmed)) continue; // already has the tag — skip
      const next = [...arr, trimmed].slice(0, 20);
      await conn.execute(
        "UPDATE documents SET tags = CAST(? AS JSON), updated_at = ? WHERE id = ?",
        [JSON.stringify(next), now, row.id]
      );
      affected++;
    }
    await conn.commit();
    return { affected };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function bulkRemoveTag(ids: string[], tag: string): Promise<{ affected: number }> {
  if (ids.length === 0 || !tag.trim()) return { affected: 0 };
  const target = tag.trim();
  const pool = await getDb();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, tags FROM documents WHERE id IN (?)",
      [ids]
    );
    let affected = 0;
    const now = new Date();
    for (const row of rows) {
      const arr = Array.isArray(row.tags)
        ? (row.tags as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
      if (!arr.includes(target)) continue;
      const next = arr.filter((t) => t !== target);
      await conn.execute(
        "UPDATE documents SET tags = CAST(? AS JSON), updated_at = ? WHERE id = ?",
        [JSON.stringify(next), now, row.id]
      );
      affected++;
    }
    await conn.commit();
    return { affected };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function bulkSetArchived(ids: string[], archived: boolean): Promise<{ affected: number }> {
  if (ids.length === 0) return { affected: 0 };
  const pool = await getDb();
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE documents SET archived = ?, updated_at = ? WHERE id IN (?)",
    [archived ? 1 : 0, new Date(), ids]
  );
  return { affected: res.affectedRows };
}

// Assign every selected doc to a collection (null clears — docs fall back to
// "No collection"). Collections are just a name column, so this IS creation:
// moving a doc to a new name brings the collection into existence.
export async function bulkSetCollection(ids: string[], collection: string | null): Promise<{ affected: number }> {
  if (ids.length === 0) return { affected: 0 };
  const pool = await getDb();
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE documents SET collection = ?, updated_at = ? WHERE id IN (?)",
    [asCollection(collection), new Date(), ids]
  );
  return { affected: res.affectedRows };
}

// ─── Version history ─────────────────────────────────────────────────────────
//
// Each meaningful update snapshots the PRE-edit state into document_versions.
// Throttled at 5 minutes — rapid keystrokes within that window update the
// most-recent snapshot rather than appending. Caps at MAX_VERSIONS per doc;
// the oldest get pruned on the next snapshot.

const VERSION_THROTTLE_MS = 5 * 60 * 1000;
const MAX_VERSIONS_PER_DOC = 25;

export interface DocumentVersion {
  id: string;
  docId: string;
  title: string;
  content: string;
  tags: string[];
  savedAt: string;
}

interface VersionRow extends RowDataPacket {
  id: string;
  doc_id: string;
  title: string;
  content: string;
  tags: string[] | null;
  saved_at: Date;
}

function versionRow(r: VersionRow): DocumentVersion {
  return {
    id: r.id,
    docId: r.doc_id,
    title: r.title,
    content: r.content ?? "",
    tags: asTags(r.tags),
    savedAt: r.saved_at.toISOString(),
  };
}

// Snapshot the existing state (before applying the patch) so the user can
// roll back. Only fires when the prior snapshot is older than the throttle,
// OR when there's no prior snapshot. Otherwise updates the prior one in
// place — the most recent snapshot reflects the last edit-cluster start.
async function maybeSnapshotVersion(existing: DocumentFull): Promise<void> {
  const pool = await getDb();
  const [rows] = await pool.query<VersionRow[]>(
    "SELECT id, doc_id, title, content, tags, saved_at FROM document_versions WHERE doc_id = ? ORDER BY saved_at DESC LIMIT 1",
    [existing.id]
  );
  const now = new Date();
  if (rows.length > 0) {
    const last = rows[0];
    const ageMs = now.getTime() - last.saved_at.getTime();
    if (ageMs < VERSION_THROTTLE_MS) {
      // Don't append; the previous snapshot is the same cluster start.
      return;
    }
  }
  const vid = crypto.randomUUID();
  await pool.execute(
    `INSERT INTO document_versions (id, doc_id, title, content, tags, saved_at)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
    [vid, existing.id, existing.title, existing.content, JSON.stringify(existing.tags), now]
  );
  // Prune older than MAX_VERSIONS.
  const [allRows] = await pool.query<VersionRow[]>(
    "SELECT id FROM document_versions WHERE doc_id = ? ORDER BY saved_at DESC",
    [existing.id]
  );
  if (allRows.length > MAX_VERSIONS_PER_DOC) {
    const toDelete = allRows.slice(MAX_VERSIONS_PER_DOC).map((r) => r.id);
    if (toDelete.length > 0) {
      await pool.query("DELETE FROM document_versions WHERE id IN (?)", [toDelete]);
    }
  }
}

// Force a snapshot of the doc's CURRENT state, bypassing the 5-minute
// throttle. Used by destructive-ish operations (Split at headings) so the
// pre-operation state is always one restore away, even when an autosave
// snapshotted moments earlier.
export async function forceSnapshotVersion(docId: string): Promise<boolean> {
  const existing = await getDocument(docId);
  if (!existing) return false;
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO document_versions (id, doc_id, title, content, tags, saved_at)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
    [crypto.randomUUID(), existing.id, existing.title, existing.content, JSON.stringify(existing.tags), new Date()]
  );
  const [allRows] = await pool.query<VersionRow[]>(
    "SELECT id FROM document_versions WHERE doc_id = ? ORDER BY saved_at DESC",
    [existing.id]
  );
  if (allRows.length > MAX_VERSIONS_PER_DOC) {
    const toDelete = allRows.slice(MAX_VERSIONS_PER_DOC).map((r) => r.id);
    if (toDelete.length > 0) {
      await pool.query("DELETE FROM document_versions WHERE id IN (?)", [toDelete]);
    }
  }
  return true;
}

export async function listDocumentVersions(docId: string): Promise<DocumentVersion[]> {
  const pool = await getDb();
  const [rows] = await pool.query<VersionRow[]>(
    "SELECT id, doc_id, title, content, tags, saved_at FROM document_versions WHERE doc_id = ? ORDER BY saved_at DESC",
    [docId]
  );
  return rows.map(versionRow);
}

export async function getDocumentVersion(versionId: string): Promise<DocumentVersion | null> {
  const pool = await getDb();
  const [rows] = await pool.query<VersionRow[]>(
    "SELECT id, doc_id, title, content, tags, saved_at FROM document_versions WHERE id = ?",
    [versionId]
  );
  return rows.length > 0 ? versionRow(rows[0]) : null;
}

// Restore a version's title/content/tags onto the doc. Snapshots current
// state first so the restore itself is undoable.
export async function restoreVersion(versionId: string): Promise<DocumentFull | null> {
  const v = await getDocumentVersion(versionId);
  if (!v) return null;
  const current = await getDocument(v.docId);
  if (!current) return null;
  // Force a snapshot of the current state regardless of throttle.
  const pool = await getDb();
  const vid = crypto.randomUUID();
  await pool.execute(
    `INSERT INTO document_versions (id, doc_id, title, content, tags, saved_at)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
    [vid, current.id, current.title, current.content, JSON.stringify(current.tags), new Date()]
  );
  // Apply restored content.
  return updateDocument(v.docId, { title: v.title, content: v.content, tags: v.tags });
}

// Export-the-snapshot helper for the surfaces that wire updateDocument into
// the editor's autosave path.
export async function snapshotBeforeUpdate(id: string): Promise<void> {
  const existing = await getDocument(id);
  if (existing) await maybeSnapshotVersion(existing);
}
