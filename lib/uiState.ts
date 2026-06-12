import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";

// Cross-device UI state — a shallow-merged JSON blob keyed by namespaced
// strings (e.g. "osint.dismissed", "crisisMap.layers"). Deliberately separate
// from UserPrefs so frequently-mutating, OSINT-tab-set values never ride along
// in the /api/user-prefs payload and can't be clobbered by a prefs Save.
export type UiState = Record<string, unknown>;

interface StateRow extends RowDataPacket {
  state: UiState | null;
}

let writeQueue: Promise<unknown> = Promise.resolve();

export async function getUiState(): Promise<UiState> {
  const pool = await getDb();
  const [rows] = await pool.query<StateRow[]>("SELECT state FROM app_ui_state WHERE id = 1");
  const s = rows[0]?.state;
  return s && typeof s === "object" && !Array.isArray(s) ? s : {};
}

// Top-level keys in `patch` replace existing ones. Serialised through a queue so
// concurrent writes (e.g. a layer toggle and a dismiss firing together) don't
// lose each other's updates.
export async function mergeUiState(patch: UiState): Promise<UiState> {
  const next = writeQueue.then(async () => {
    const current = await getUiState();
    const merged = { ...current, ...patch };
    const pool = await getDb();
    await pool.execute(
      `INSERT INTO app_ui_state (id, state, updated_at) VALUES (1, CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE state = VALUES(state), updated_at = VALUES(updated_at)`,
      [JSON.stringify(merged), new Date()]
    );
    return merged;
  });
  writeQueue = next.catch((err) => {
    console.error("Failed to persist UI state:", err);
  });
  return next;
}
