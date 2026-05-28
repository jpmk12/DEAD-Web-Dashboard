import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

// Temporary diagnostic endpoint to debug auth/config when server logs aren't
// available. Exposes only env-var PRESENCE (booleans) for secrets — never their
// values — plus a few non-secret values (URL/email/host) needed to diagnose the
// OAuth redirect host. Remove this route once sign-in works.
export async function GET() {
  const h = await headers();
  const present = (v?: string | null) => Boolean(v && v.length > 0);

  return NextResponse.json({
    note: "Temporary diagnostic — remove after sign-in works. No secret values are exposed.",
    env_present: {
      AUTH_SECRET_or_NEXTAUTH_SECRET: present(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET),
      GOOGLE_CLIENT_ID: present(process.env.GOOGLE_CLIENT_ID),
      GOOGLE_CLIENT_SECRET: present(process.env.GOOGLE_CLIENT_SECRET),
      ANTHROPIC_API_KEY: present(process.env.ANTHROPIC_API_KEY),
      DB_HOST: present(process.env.DB_HOST),
      DB_NAME: present(process.env.DB_NAME),
      DB_USER: present(process.env.DB_USER),
      DB_PASSWORD: present(process.env.DB_PASSWORD),
    },
    config_values: {
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? null,
      AUTH_URL: process.env.AUTH_URL ?? null,
      OWNER_EMAIL: process.env.OWNER_EMAIL ?? null,
      NODE_ENV: process.env.NODE_ENV ?? null,
      GOOGLE_CLIENT_ID_suffix: process.env.GOOGLE_CLIENT_ID
        ? "…" + process.env.GOOGLE_CLIENT_ID.slice(-30)
        : null,
    },
    request_host_seen_by_app: {
      host: h.get("host"),
      "x-forwarded-host": h.get("x-forwarded-host"),
      "x-forwarded-proto": h.get("x-forwarded-proto"),
    },
  });
}
