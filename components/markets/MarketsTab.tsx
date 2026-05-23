"use client";

import { useEffect, useRef, useState } from "react";

const TICKER_CFG = JSON.stringify({
  symbols: [
    { proName: "FOREXCOM:SPXUSD", title: "S&P 500" },
    { proName: "DJ:DJI",          title: "DOW" },
    { proName: "NASDAQ:NDX",      title: "NASDAQ" },
    { proName: "CBOE:VIX",        title: "VIX" },
    { proName: "NYMEX:CL1!",      title: "WTI Oil" },
    { proName: "COMEX:GC1!",      title: "Gold" },
  ],
  showSymbolLogo: false,
  colorTheme: "dark",
  isTransparent: true,
  displayMode: "adaptive",
  locale: "en",
});

const OVERVIEW_CFG = JSON.stringify({
  colorTheme: "dark",
  dateRange: "1D",
  showChart: true,
  locale: "en",
  width: "100%",
  height: 520,
  isTransparent: true,
  showSymbolLogo: false,
  showFloatingTooltip: false,
  plotLineColorGrowing: "rgb(16, 185, 129)",
  plotLineColorFalling: "rgb(239, 68, 68)",
  gridLineColor: "rgba(51, 65, 85, 0.5)",
  scaleFontColor: "rgba(148, 163, 184, 1)",
  belowLineFillColorGrowing: "rgba(16, 185, 129, 0.12)",
  belowLineFillColorFalling: "rgba(239, 68, 68, 0.12)",
  symbolActiveColor: "rgba(16, 185, 129, 0.12)",
  tabs: [
    {
      title: "Indices",
      symbols: [
        { s: "FOREXCOM:SPXUSD", d: "S&P 500" },
        { s: "DJ:DJI",          d: "DJIA" },
        { s: "NASDAQ:NDX",      d: "NASDAQ 100" },
        { s: "CBOE:VIX",        d: "VIX" },
      ],
      originalTitle: "Indices",
    },
    {
      title: "Defense",
      symbols: [
        { s: "NYSE:LMT",    d: "Lockheed Martin" },
        { s: "NYSE:RTX",    d: "RTX Corp" },
        { s: "NYSE:NOC",    d: "Northrop Grumman" },
        { s: "NYSE:GD",     d: "General Dynamics" },
        { s: "NYSE:BA",     d: "Boeing" },
        { s: "NYSE:HII",    d: "Huntington Ingalls" },
        { s: "NYSE:LHX",    d: "L3Harris" },
        { s: "NYSE:SAIC",   d: "SAIC" },
        { s: "NASDAQ:CACI", d: "CACI" },
      ],
      originalTitle: "Defense",
    },
    {
      title: "Energy",
      symbols: [
        { s: "NYMEX:CL1!", d: "WTI Crude" },
        { s: "NYMEX:BZ1!", d: "Brent Crude" },
        { s: "COMEX:GC1!", d: "Gold" },
        { s: "COMEX:SI1!", d: "Silver" },
      ],
      originalTitle: "Energy",
    },
  ],
});

// TradingView widgets need:
// 1. Outer div with class "tradingview-widget-container"
// 2. Inner div with class "tradingview-widget-container__widget" (widget injects here)
// 3. A <script> with src + JSON config as text content (read via document.currentScript)
function TVWidget({ widgetType, configJson, height }: {
  widgetType: string;
  configJson: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    // Prevent double-mount in React strict mode
    if (mounted.current) return;
    mounted.current = true;

    const container = ref.current;
    if (!container) return;

    container.className = "tradingview-widget-container";
    if (height) container.style.height = `${height}px`;

    // Required target div — widget script injects its iframe here
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    inner.style.width = "100%";
    container.appendChild(inner);

    // Script with config as text node (read by TradingView via document.currentScript.textContent)
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${widgetType}.js`;
    script.async = true;
    script.appendChild(document.createTextNode(configJson));
    container.appendChild(script);

    return () => {
      // Do NOT reset mounted.current here — keeping it true prevents re-injection
      // after React Strict Mode's intentional unmount/remount cycle.
      container.innerHTML = "";
      container.removeAttribute("style");
      container.className = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={ref} />;
}

function formatUpdated(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function MarketsTab() {
  const [widgetKey, setWidgetKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-emerald-400 text-xs">◈</span>
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Markets</h2>
            <p className="text-[10px] text-slate-600 font-mono">Live market data — Defense sector &amp; key indices</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-700 font-mono">{formatUpdated(lastUpdated)}</span>
          <button
            onClick={() => { setWidgetKey((k) => k + 1); setLastUpdated(new Date()); }}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-400 font-mono transition-colors"
          >
            <span className="text-base leading-none">↻</span>
            Refresh
          </button>
        </div>
      </div>

      {/* Ticker tape */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden min-h-[56px]">
        <TVWidget key={`ticker-${widgetKey}`} widgetType="ticker-tape" configJson={TICKER_CFG} />
      </div>

      {/* Market overview */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden" style={{ height: 540 }}>
        <TVWidget key={`overview-${widgetKey}`} widgetType="market-overview" configJson={OVERVIEW_CFG} height={540} />
      </div>

      {/* Attribution */}
      <p className="text-[10px] text-slate-700 text-right">
        Market data by{" "}
        <a
          href="https://www.tradingview.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-600 hover:text-slate-400 underline transition-colors"
        >
          TradingView
        </a>
      </p>
    </div>
  );
}
