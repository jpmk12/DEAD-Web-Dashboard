// Server-only accessors for the family roster.
//
// Stored in a dedicated `user_prefs.family_profile` column rather than inside
// the UserPrefs JSON blob — same discipline as the ACLED credentials and the
// SITREP bases. A normal Preferences save must not be able to clobber the
// roster, and the roster must not ride along in the /api/user-prefs GET that
// every tab fetches: it names the user's children and their schools, which is
// the most sensitive data in this app and has no business in a payload that
// exists to render tab chrome.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { sanitizeFamilyProfile, EMPTY_FAMILY_PROFILE, type FamilyProfile } from "./familyProfile";

interface Row extends RowDataPacket { family_profile: unknown }

export async function getFamilyProfile(): Promise<FamilyProfile> {
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>("SELECT family_profile FROM user_prefs WHERE id = 1");
    const raw = rows[0]?.family_profile;
    if (!raw) return { ...EMPTY_FAMILY_PROFILE };
    // mysql2 hands back JSON columns already parsed on some driver versions and
    // as a string on others — accept both rather than depending on which.
    return sanitizeFamilyProfile(typeof raw === "string" ? safeParse(raw) : raw);
  } catch (err) {
    console.error("family profile read failed:", err);
    return { ...EMPTY_FAMILY_PROFILE };
  }
}

export async function saveFamilyProfile(profile: FamilyProfile): Promise<FamilyProfile> {
  const clean = sanitizeFamilyProfile(profile);
  const pool = await getDb();
  // `last_updated` is NOT NULL with no DEFAULT. MySQL validates the INSERT row
  // in strict mode even when the duplicate-key path will win, so omitting the
  // column fails with ER_NO_DEFAULT_FOR_FIELD on EVERY save, not just the
  // insert case. saveAcledCredentials already solved this on the same table —
  // this now matches it. The ON DUPLICATE clause deliberately does NOT touch
  // last_updated: it is the team-config timestamp other caches key off, and a
  // roster edit should not invalidate them.
  await pool.execute(
    `INSERT INTO user_prefs (id, family_profile, last_updated) VALUES (1, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE family_profile = VALUES(family_profile)`,
    [JSON.stringify(clean), new Date()],
  );
  return clean;
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
