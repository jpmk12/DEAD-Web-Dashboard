// Deep-link to a message in Gmail's web UI. `#all/<id>` opens it regardless of
// which label it lives under. Account targeting uses authuser=<email> rather
// than a numeric /u/N index so it opens the correct inbox in a multi-account
// browser session regardless of sign-in order.
//
// Returns null when either piece is missing — in particular, WITHOUT an account
// email we'd fall back to the browser's default account and land on the wrong
// mailbox (a broken link), so we render no link at all in that case.
export function gmailMessageUrl(id: string | undefined, accountEmail: string | undefined): string | null {
  if (!id || !accountEmail) return null;
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${id}`;
}
