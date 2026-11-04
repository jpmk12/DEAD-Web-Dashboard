// Shared bits for the Tools tab's cards (no fetch, no storage — the privacy
// test scans this file too).
export const Card = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
  <section className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
    <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between gap-3 flex-wrap">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">{title}</h3>
      {sub && <span className="text-[10px] font-mono text-slate-600">{sub}</span>}
    </header>
    <div className="p-4 space-y-3">{children}</div>
  </section>
);

export const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{children}</span>
);

export const inputCls = "bg-slate-950/60 border border-slate-700 rounded-md px-2 py-1.5 text-[12px] font-mono text-slate-100 focus:outline-none focus:border-sky-500/60 [color-scheme:dark]";

export interface ZoneCol { zone: string; label: string }
