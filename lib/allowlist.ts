// Sign-in allowlist — PURE (client-safe, unit-tested). The dashboard is
// owner-plus-small-crew: OWNER_EMAIL is the admin (diag routes, team config
// writes), ALLOWED_EMAILS is a comma-separated list of additional Google
// accounts permitted to sign in. Matching is case-insensitive and
// whitespace-tolerant (env UIs love sneaking in spaces/newlines).

export function normEmail(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

export function parseEmailList(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map(normEmail)
    .filter((e) => e.includes("@"));
}

export function isAllowedEmail(
  email: string | null | undefined,
  ownerRaw: string | null | undefined,
  allowedRaw: string | null | undefined,
): boolean {
  const e = normEmail(email);
  if (!e) return false;
  const owner = normEmail(ownerRaw);
  if (!owner) return false;                 // no owner configured → nobody in
  if (e === owner) return true;
  return parseEmailList(allowedRaw).includes(e);
}

// Owner identity — env-driven, no auth import, so DB libs (and their tests)
// can use it without dragging NextAuth into the module graph.
export function ownerEmail(): string {
  return normEmail(process.env.OWNER_EMAIL);
}

export function isOwner(email: string | null | undefined): boolean {
  const o = ownerEmail();
  return !!o && normEmail(email) === o;
}
