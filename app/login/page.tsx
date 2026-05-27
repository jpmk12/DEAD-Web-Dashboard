import GoogleButton from "./google-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const callbackUrl = sp.callbackUrl ?? "/";
  const error = sp.error;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-slate-950 text-slate-100 px-6 text-center">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
          <span className="text-emerald-400 text-sm">◆</span>
        </div>
        <h1 className="text-lg font-bold tracking-widest uppercase">DEAD&apos;s Dashboard</h1>
      </div>

      <p className="text-slate-400 text-sm max-w-sm">
        Sign in with the authorized Google account to access your dashboard.
      </p>

      {error && (
        <p className="text-red-400 text-xs max-w-sm">
          Sign-in failed{error === "AccessDenied" ? " — this account isn’t authorized." : "."} Please try again.
        </p>
      )}

      <GoogleButton callbackUrl={callbackUrl} />
    </div>
  );
}
