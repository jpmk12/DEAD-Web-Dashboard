// Shared timeout wrapper for every outbound fetch. The house rule (CLAUDE.md /
// SESSION-CONTEXT) is an 8–12 s server-side timeout on all external calls so a
// slow upstream can never hold a user-facing response; this makes the pattern
// one import instead of an AbortController dance at each call site.
//
// Throws on timeout exactly like fetch throws on network failure, so existing
// try/catch fallbacks keep working unchanged.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}
