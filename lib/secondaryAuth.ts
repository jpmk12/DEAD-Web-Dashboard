import { EncryptJWT, jwtDecrypt } from "jose";
import { hkdfSync } from "crypto";

export const COOKIE_NAME = "secondary_gmail";

export interface SecondaryTokenPayload {
  access_token: string;
  refresh_token?: string;
  expiry_date: number;
  email: string;
}

// Derive a 32-byte key via HKDF-SHA256 so the raw secret is never used
// directly as an encryption key, and a different key is produced for this
// specific purpose even if NEXTAUTH_SECRET is reused elsewhere.
function getKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return new Uint8Array(
    hkdfSync("sha256", secret, "imagic-secondary-gmail-salt-v1", "secondary-gmail-token-v1", 32)
  );
}

export async function encryptToken(payload: SecondaryTokenPayload): Promise<string> {
  return new EncryptJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .encrypt(getKey());
}

export async function decryptToken(jwe: string): Promise<SecondaryTokenPayload | null> {
  try {
    const { payload } = await jwtDecrypt(jwe, getKey());
    const p = payload as unknown as SecondaryTokenPayload;
    if (!p?.access_token || typeof p.access_token !== "string" || !p.email || !p.expiry_date) return null;
    return p;
  } catch (err) {
    console.warn("[secondaryAuth] JWE decryption failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// Returns the payload with a valid (non-expired) access token, refreshing
// automatically if needed. Returns { payload, refreshedJwe } where refreshedJwe
// is set when the token was refreshed — the caller should write it back to the
// cookie so future requests don't also trigger a refresh.
export async function getValidSecondaryToken(raw: string): Promise<{
  payload: SecondaryTokenPayload;
  refreshedJwe?: string;
} | null> {
  const payload = await decryptToken(raw);
  if (!payload) return null;

  // Normalize "unknown" stored by an older token before the Gmail profile fix
  if (payload.email === "unknown") payload.email = "";

  // Token still has more than 60 seconds — use it as-is
  if (payload.expiry_date >= Date.now() + 60_000) {
    return { payload };
  }

  // Expired or expiring — attempt refresh
  if (!payload.refresh_token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: payload.refresh_token,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      }),
    });
    clearTimeout(timer);

    if (!refreshRes.ok) return null;
    const tokens = await refreshRes.json() as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!tokens.access_token) return null;

    const refreshed: SecondaryTokenPayload = {
      ...payload,
      access_token: tokens.access_token,
      expiry_date: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      refresh_token: tokens.refresh_token ?? payload.refresh_token,
    };

    const refreshedJwe = await encryptToken(refreshed);
    return { payload: refreshed, refreshedJwe };
  } catch (err) {
    clearTimeout(timer);
    console.warn("[secondaryAuth] Token refresh failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
