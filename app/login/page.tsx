import { cookies } from "next/headers";
import LoginPanel from "@/components/LoginPanel";
import GoogleSignInForm from "@/components/GoogleSignInForm";
import { PRIMARY_HINT_COOKIE, NO_HINT, pickHint } from "@/lib/primaryHint";

export const dynamic = "force-dynamic";

// Which account to name to Google, in order: `?hint=<email>` (the expired
// session's own address, from SessionExpiredBanner) → the device cookie set by
// /api/auth/primary-hint → none (chooser forced). `?hint=none` is the explicit
// "use a different account" — it also wins over the cookie.
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const urlHint = typeof params.hint === "string" ? params.hint : undefined;
  const cookieHint = (await cookies()).get(PRIMARY_HINT_COOKIE)?.value;
  const hint = urlHint === NO_HINT ? null : pickHint(urlHint, cookieHint);
  const callbackUrl = typeof params.callbackUrl === "string" && params.callbackUrl.startsWith("/") ? params.callbackUrl : "/";

  return (
    <LoginPanel hint={hint} signInSlot={<GoogleSignInForm callbackUrl={callbackUrl} loginHint={hint} />} />
  );
}
