"use client";

// Dependency-free inline SVG sparklines for compact weather trends. Sized via
// viewBox so the caller controls display width with a CSS class (e.g. w-full).

export function Sparkline({
  values,
  width = 150,
  height = 28,
  className = "text-sky-400 w-full",
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const n = values.length;
  const pad = 2;
  const pts = values
    .map((v, i) => {
      if (typeof v !== "number") return null;
      const x = (i / (n - 1)) * (width - pad * 2) + pad;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} height={height} className={`block ${className}`} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function PrecipBars({
  values,
  width = 150,
  height = 12,
  className = "text-sky-500/50 w-full",
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const n = values.length;
  if (n === 0) return null;
  const bw = width / n;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} height={height} preserveAspectRatio="none" className={`block ${className}`} aria-hidden>
      {values.map((v, i) => {
        const pct = typeof v === "number" ? v : 0;
        const h = Math.max(1, (pct / 100) * (height - 1));
        return <rect key={i} x={i * bw + 0.5} y={height - h} width={Math.max(1, bw - 1)} height={h} fill="currentColor" />;
      })}
    </svg>
  );
}
