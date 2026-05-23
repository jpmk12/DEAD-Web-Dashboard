"use client";

interface BulkActionBarProps {
  count: number;
  onMarkRead: () => void;
  onClear: () => void;
  loading: boolean;
}

export default function BulkActionBar({ count, onMarkRead, onClear, loading }: BulkActionBarProps) {
  if (count === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900/95 backdrop-blur-sm border border-slate-700 text-white px-5 py-3 rounded-2xl shadow-2xl">
      <span className="text-sm font-bold text-slate-200">
        {count} selected
      </span>
      <div className="w-px h-4 bg-slate-700" />
      <button
        onClick={onMarkRead}
        disabled={loading}
        className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold px-4 py-1.5 rounded-lg disabled:opacity-50 transition-all glow-green"
      >
        {loading ? "Marking…" : "Mark read"}
      </button>
      <button
        onClick={onClear}
        disabled={loading}
        className="text-slate-500 hover:text-slate-300 text-sm font-mono transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
