// Which Google account the PRIMARY sign-in should ask for — PURE, client-safe.
//
// The bug this closes ("on my phone the dashboard switched to my other Gmail
// instead of adding it"): the secondary-Gmail flow never touches the primary
// login, but it does make the second account the ACTIVE Google session in
// that browser. The primary sign-in then asked Google for `prompt=consent`
// with no account named, and Google answers that with whichever account is
// active — now the secondary. The primary refresh token expires weekly under
// a Testing-status consent screen, so "Sign in again" came round often, and
// each time it silently re-established the primary AS the secondary. Phones
// show it first because a phone's Safari usually holds one Google session
// (so no chooser ever appeared) and because the installed app re-signs-in
// more.
//
// Fix: never let Google pick. Either we NAME the account (`login_hint`, from
// the session that just expired or from a cookie remembering the last primary
// on this device) or we force the chooser (`select_account`). A silent default
// is the one thing the primary sign-in must not do.

export const PRIMARY_HINT_COOKIE = "dead_primary_hint";
export const PRIMARY_HINT_MAX_AGE = 365 * 24 * 60 * 60;

/** The URL value that means "do not hint — show me the chooser". */
export const NO_HINT = "none";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A usable login hint, lowercased, or null: only something email-shaped and
 *  under Gmail's length cap is ever handed to Google. `none`/empty → null. */
export function normalizeHint(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!s || s === NO_HINT || s.length > 254 || !EMAIL_RE.test(s)) return null;
  return s;
}

/** Authorization params for the primary Google sign-in. With a hint Google
 *  preselects that account (and still asks consent, so a refresh token is
 *  issued); without one the chooser is forced so the active session is
 *  never silently reused. */
export function primaryAuthParams(hint: string | null | undefined): Record<string, string> {
  const h = normalizeHint(hint);
  return h
    ? { login_hint: h, prompt: "consent" }
    : { prompt: "select_account consent" };
}

/** The first usable hint among candidates (URL param wins over cookie). */
export function pickHint(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const h = normalizeHint(c);
    if (h) return h;
  }
  return null;
}
