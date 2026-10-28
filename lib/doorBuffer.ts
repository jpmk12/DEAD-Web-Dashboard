// Door-event buffer — client-only, tiny, tested (tests/doorBuffer.test.ts).
//
// Several doors into a tab are window events fired a beat after navigating to
// it (`docs:open` 60–120 ms after `app:navigate docs`). A tab that mounts on
// FIRST activation and arrives as a lazy chunk (lib/lazyClient) is not yet
// listening when that event fires, so the door would open an empty tab. The
// shell (always mounted) parks the newest event of each named kind; the tab
// takes it on mount. A parked event older than `maxAgeMs` is stale and is
// dropped — a door is a request made NOW, not a standing instruction.

const parked = new Map<string, { detail: unknown; at: number }>();
const installed = new Set<string>();

/** Record an event by name (exported for tests; the shell uses install). */
export function parkDoor(name: string, detail: unknown, at = Date.now()): void {
  parked.set(name, { detail, at });
}

/** Listen for these event names on `window` and park the newest of each.
 *  Idempotent per name. */
export function installDoorBuffer(names: string[]): void {
  if (typeof window === "undefined") return;
  for (const n of names) {
    if (installed.has(n)) continue;
    installed.add(n);
    window.addEventListener(n, (e) => parkDoor(n, (e as CustomEvent).detail));
  }
}

/** Take (and clear) the parked event of this kind, or undefined when there
 *  is none or it is older than `maxAgeMs`. */
export function takeDoor(name: string, maxAgeMs = 15_000, now = Date.now()): unknown {
  const p = parked.get(name);
  parked.delete(name);
  if (!p || now - p.at > maxAgeMs) return undefined;
  return p.detail;
}
