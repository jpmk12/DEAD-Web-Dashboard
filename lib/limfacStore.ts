// Commander-entered SITREP LIMFACs — server-only CRUD. SHARED per base (icao):
// the whole crew sees and maintains the same airfield LIMFAC list, each entry
// attributed to whoever entered it. Auto-derived LIMFACs are NOT stored (they
// come from lib/limfac deriveMissionImpact) — only human-known ones live here.

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { Capability, LimfacStatus, ManualLimfac } from "./limfac";
import { MISSION_FUNCTIONS } from "./limfac";

const FN_KEYS = new Set(MISSION_FUNCTIONS.map((f) => f.key));
const CAPS = new Set<Capability>(["fmc", "pmc", "nmc", "unknown"]);
const STATUSES = new Set<LimfacStatus>(["new", "ongoing", "improving", "worsening", "resolved"]);

interface Row extends RowDataPacket {
  id: string; icao: string; fn: string; capability: string;
  driver: string; impact: string; mitigation: string | null; ask: string | null;
  ccir: number; from_iso: string | null; to_iso: string | null;
  status: string; entered_by: string | null; created_at: Date;
}

function rowTo(r: Row): ManualLimfac {
  return {
    id: r.id, icao: r.icao, fn: r.fn,
    capability: (CAPS.has(r.capability as Capability) ? r.capability : "pmc") as Capability,
    driver: r.driver, impact: r.impact,
    mitigation: r.mitigation, ask: r.ask, ccir: Boolean(r.ccir),
    fromISO: r.from_iso, toISO: r.to_iso,
    status: (STATUSES.has(r.status as LimfacStatus) ? r.status : "ongoing") as LimfacStatus,
    enteredBy: r.entered_by, createdAt: r.created_at.toISOString(),
  };
}

// Active (unresolved) LIMFACs for a base — what deriveMissionImpact merges.
export async function listLimfacs(icao: string, includeResolved = false): Promise<ManualLimfac[]> {
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>(
    `SELECT id, icao, fn, capability, driver, impact, mitigation, ask, ccir, from_iso, to_iso, status, entered_by, created_at
     FROM sitrep_limfacs WHERE icao = ?${includeResolved ? "" : " AND status <> 'resolved'"} ORDER BY created_at DESC`,
    [icao.toUpperCase()]
  );
  return rows.map(rowTo);
}

export interface LimfacInput {
  icao: string; fn: string; capability: Capability;
  driver: string; impact: string;
  mitigation?: string | null; ask?: string | null; ccir?: boolean;
  fromISO?: string | null; toISO?: string | null;
  enteredBy?: string | null;
}

function clean(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}
function cleanIso(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// Returns the created row, or null when required fields are missing/invalid.
export async function createLimfac(input: LimfacInput): Promise<ManualLimfac | null> {
  const icao = clean(input.icao, 4).toUpperCase();
  const fn = FN_KEYS.has(input.fn) ? input.fn : "";
  const capability = CAPS.has(input.capability) ? input.capability : "pmc";
  const driver = clean(input.driver, 300);
  const impact = clean(input.impact, 500);
  if (!/^[A-Z0-9]{4}$/.test(icao) || !fn || !driver || !impact) return null;
  const id = randomUUID();
  const now = new Date();
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO sitrep_limfacs (id, icao, fn, capability, driver, impact, mitigation, ask, ccir, from_iso, to_iso, status, entered_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
    [id, icao, fn, capability, driver, impact,
     clean(input.mitigation, 500) || null, clean(input.ask, 500) || null,
     input.ccir ? 1 : 0, cleanIso(input.fromISO), cleanIso(input.toISO),
     clean(input.enteredBy, 255) || null, now, now]
  );
  return {
    id, icao, fn, capability, driver, impact,
    mitigation: clean(input.mitigation, 500) || null, ask: clean(input.ask, 500) || null,
    ccir: Boolean(input.ccir), fromISO: cleanIso(input.fromISO), toISO: cleanIso(input.toISO),
    status: "new", enteredBy: clean(input.enteredBy, 255) || null, createdAt: now.toISOString(),
  };
}

export async function updateLimfacStatus(id: string, status: LimfacStatus): Promise<boolean> {
  if (!STATUSES.has(status)) return false;
  const pool = await getDb();
  const [res] = await pool.execute(
    "UPDATE sitrep_limfacs SET status = ?, updated_at = NOW(3) WHERE id = ?",
    [status, id]
  ) as unknown as [{ affectedRows: number }];
  return res.affectedRows > 0;
}

// "Keep active" on a stale LIMFAC: drop the (passed) end window so it reads as
// open-ended (UFN) and stops nagging, while staying on the register.
export async function openEndLimfac(id: string): Promise<boolean> {
  const pool = await getDb();
  const [res] = await pool.execute(
    "UPDATE sitrep_limfacs SET to_iso = NULL, status = 'ongoing', updated_at = NOW(3) WHERE id = ?",
    [id]
  ) as unknown as [{ affectedRows: number }];
  return res.affectedRows > 0;
}

export async function deleteLimfac(id: string): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM sitrep_limfacs WHERE id = ?", [id]);
}
