// Server-only session identity helpers for the multi-user split. Personal
// surfaces (brief cache, chat memory, surface state, UI state) are keyed by
// the session email; rows written before multi-user carry user_email = ''
// and are honoured as the OWNER's legacy rows (reads prefer the exact-email
// row, fall back to '' only for the owner).

import { auth } from "./auth";
import { normEmail } from "./allowlist";

export function ownerEmail(): string {
  return normEmail(process.env.OWNER_EMAIL);
}

export function isOwner(email: string | null | undefined): boolean {
  const o = ownerEmail();
  return !!o && normEmail(email) === o;
}

export interface SessionUser {
  email: string;     // normalized (lowercase)
  isOwner: boolean;
}

// Resolves the signed-in user, or null when there's no valid session. Routes
// that need auth anyway should keep their session.accessToken check and use
// this for the identity.
export async function sessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return null;
  return { email, isOwner: isOwner(email) };
}
