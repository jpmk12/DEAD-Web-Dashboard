import { signIn } from "@/lib/auth";
import { primaryAuthParams } from "@/lib/primaryHint";

// Sign-in that does not depend on client JavaScript.
//
// The original button called signIn() from next-auth/react, which is a CLIENT
// call: it fetches /api/auth/csrf, then POSTs to /api/auth/signin/google. On a
// locked-down machine where script execution is filtered — or where that csrf
// fetch is blocked — the click produces literally nothing, which is exactly
// how "the Login with Google button does not work" presents while
// accounts.google.com itself loads fine.
//
// This is a Server Action inside a plain <form>. Next.js progressively
// enhances it: with JS it posts in the background, without JS the browser
// submits the form natively and the server issues the redirect to Google. The
// OAuth flow after that point is ordinary top-level navigation, which nothing
// about a restricted browser interferes with.
//
// `loginHint` names the account Google should sign in (lib/primaryHint.ts):
// the one whose session just expired, or the last primary remembered on this
// device. Without it the chooser is forced. Google is never left to pick the
// browser's active account — that is how the secondary Gmail used to become
// the primary on phones.
//
// Rendered from the server components that show the login screen and passed
// into LoginPanel as children, because LoginPanel is "use client" and cannot
// import a Server Action module itself.

export default function GoogleSignInForm({ callbackUrl = "/", loginHint = null }: { callbackUrl?: string; loginHint?: string | null }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: callbackUrl }, primaryAuthParams(loginHint));
      }}
    >
      <button
        type="submit"
        className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold uppercase tracking-wider px-5 py-2.5 rounded-md transition-colors"
      >
        Sign in with Google
      </button>
    </form>
  );
}
