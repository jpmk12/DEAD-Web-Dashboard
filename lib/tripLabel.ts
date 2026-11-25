// A trip's LABEL is free text; its LOCATION is what was geocoded and what the
// weather, zone and brief actually read. The two drifted apart once (2026-11-25:
// a "Jordan" trip relabelled "Spangdahlem" kept Jordan's coordinates and the
// TDY card showed Jordan's weather under the Spangdahlem name), so every surface
// that shows a trip's label must also say where it was LOCATED when the label
// does not already say it. PURE, tested in tests/tripLabel.test.ts.

const norm = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The located place, or null when the label already names it. */
export function locatedAs(label: string, location: string): string | null {
  const l = norm(label);
  const loc = norm(location);
  if (!loc) return null;
  if (l === loc || l.includes(loc)) return null;
  // "Amman" labelling "Amman, Jordan": the label names the place's first part.
  const head = loc.split(",")[0].trim();
  if (head.length >= 3 && l.includes(head)) return null;
  return location.trim();
}

/** "Spangdahlem (TDY · located: Jordan)" — or "Amman (TDY)" when they agree. */
export function tripCardLabel(label: string, location: string): string {
  const at = locatedAs(label, location);
  return at ? `${label} (TDY · located: ${at})` : `${label} (TDY)`;
}

/** A label that was only ever the location follows a new location; a typed
 *  label ("Exercise Eager Lion") stays as the user wrote it. */
export function labelAfterMove(oldLabel: string, oldLocation: string, newLocation: string, requested?: string): string {
  const req = (requested ?? "").trim();
  if (req && norm(req) !== norm(oldLabel)) return req;
  return norm(oldLabel) === norm(oldLocation) ? newLocation.trim() : oldLabel;
}
