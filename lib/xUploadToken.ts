// Per-user upload tokens for UNATTENDED X capture — server-only. The browser
// extension (or a local scheduled script) POSTs a dead-x-capture file to
// /api/osint/x-import with `Authorization: Bearer <token>` instead of an
// interactive session. Security discipline (mirrors ACLED creds): store ONLY the
// SHA-256 hash; the plaintext is returned once at generation and never again.

import { createHash, randomBytes } from "crypto";
import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";

const PREFIX = "xcap_";

// PURE helpers (unit-tested) — no DB.
export function hashXToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function looksLikeXToken(token: string): boolean {
  return typeof token === "string" && token.startsWith(PREFIX) && token.length >= PREFIX.length + 24;
}
export function newXToken(): string {
  return PREFIX + randomBytes(24).toString("base64url");
}

export interface XTokenStatus {
  configured: boolean;
  label: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  expectedIntervalHours: number | null;  // self-reported by the extension → the pill's cadence
}

interface TokRow extends RowDataPacket {
  user_email: string; label: string; created_at: Date; last_used_at: Date | null; expected_interval_hours: number | null;
}

// One active token per user — regenerating rotates (drops the old hash).
export async function generateXUploadToken(userEmail: string, label = "browser extension"): Promise<string> {
  const token = newXToken();
  const pool = await getDb();
  await pool.execute("DELETE FROM x_upload_tokens WHERE user_email = ?", [userEmail]);
  await pool.execute(
    "INSERT INTO x_upload_tokens (token_hash, user_email, label, created_at) VALUES (?, ?, ?, NOW(3))",
    [hashXToken(token), userEmail, label.slice(0, 80)],
  );
  return token;
}

export async function getXUploadTokenStatus(userEmail: string): Promise<XTokenStatus> {
  const pool = await getDb();
  const [rows] = await pool.query<TokRow[]>(
    "SELECT user_email, label, created_at, last_used_at, expected_interval_hours FROM x_upload_tokens WHERE user_email = ? LIMIT 1",
    [userEmail],
  );
  const r = rows[0];
  if (!r) return { configured: false, label: null, createdAt: null, lastUsedAt: null, expectedIntervalHours: null };
  return {
    configured: true,
    label: r.label,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
    expectedIntervalHours: r.expected_interval_hours ?? null,
  };
}

// The extension self-reports its capture cadence on each upload (a header), so
// the dashboard's freshness pill can judge staleness against the ACTUAL schedule
// instead of a hardcoded daily assumption.
export async function setXTokenCadence(userEmail: string, hours: number): Promise<void> {
  const h = Math.round(hours);
  if (!Number.isFinite(h) || h < 1 || h > 168) return;
  const pool = await getDb();
  await pool.execute("UPDATE x_upload_tokens SET expected_interval_hours = ? WHERE user_email = ?", [h, userEmail]);
}

// Verify a presented token → the email it belongs to, or null. Bumps last_used.
export async function verifyXUploadToken(token: string): Promise<string | null> {
  if (!looksLikeXToken(token)) return null;
  const hash = hashXToken(token);
  const pool = await getDb();
  const [rows] = await pool.query<TokRow[]>(
    "SELECT user_email FROM x_upload_tokens WHERE token_hash = ? LIMIT 1",
    [hash],
  );
  const r = rows[0];
  if (!r) return null;
  pool.execute("UPDATE x_upload_tokens SET last_used_at = NOW(3) WHERE token_hash = ?", [hash]).catch(() => {});
  return r.user_email;
}

export async function revokeXUploadToken(userEmail: string): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM x_upload_tokens WHERE user_email = ?", [userEmail]);
}
