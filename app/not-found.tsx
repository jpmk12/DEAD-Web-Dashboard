import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-950 text-slate-100 px-6 text-center">
      <p className="text-emerald-400 text-sm font-bold tracking-widest uppercase">404</p>
      <h1 className="text-xl font-bold">Page not found</h1>
      <p className="text-slate-400 text-sm max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link
        href="/"
        className="mt-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-md transition-colors"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
