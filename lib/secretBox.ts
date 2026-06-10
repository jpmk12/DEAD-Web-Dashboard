import { EncryptJWT, jwtDecrypt } from "jose";
import { hkdfSync } from "crypto";

// App-level encryption for secrets stored at rest (currently the ACLED password
// in user_prefs). Mirrors lib/secondaryAuth's approach — an HKDF-SHA256 key
// derived from NEXTAUTH_SECRET so the raw secret is never used directly — but
// with its own salt/info, so this key is independent of the gmail-token key
// even though both ultimately derive from NEXTAUTH_SECRET.
//
// Format: the "v1." prefix + a compact JWE (dir / A256GCM) wrapping { v: secret }.
// The prefix lets decryptSecret tell an encrypted value apart from any legacy
// plaintext written before encryption existed (such values are returned as-is
// and get re-encrypted on the next save).

const PREFIX = "v1.";

function getKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set — required to encrypt secrets at rest");
  return new Uint8Array(
    hkdfSync("sha256", secret, "dead-secretbox-salt-v1", "dead-secretbox-key-v1", 32)
  );
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const jwe = await new EncryptJWT({ v: plaintext })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .encrypt(getKey());
  return PREFIX + jwe;
}

// Returns the plaintext secret. A value without the encrypted prefix is treated
// as legacy plaintext and returned unchanged. Returns "" when an encrypted value
// can't be decrypted (rotated/wrong NEXTAUTH_SECRET, or tampering) so callers
// treat it as unconfigured rather than crashing.
export async function decryptSecret(stored: string): Promise<string> {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  try {
    const { payload } = await jwtDecrypt(stored.slice(PREFIX.length), getKey());
    const v = (payload as { v?: unknown }).v;
    return typeof v === "string" ? v : "";
  } catch (err) {
    console.warn("[secretBox] decryption failed:", err instanceof Error ? err.message : String(err));
    return "";
  }
}
