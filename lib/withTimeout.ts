// A bounded wait — the ONE home (housekeeping 2026-11-04: eight copies).
// Resolves to the promise's value, or null when it rejects or takes longer
// than `ms`. A dead or slow source degrades to "unreachable", never a hang
// and never a throw — the caller decides what null means (UNKNOWN, not clear).
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}
