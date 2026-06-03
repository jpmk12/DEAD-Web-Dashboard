"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TickerEntry, NewsItem } from "@/lib/types";
import ContractsPanel from "./ContractsPanel";
import MacroBriefPanel from "./MacroBriefPanel";

const INDICES: TickerEntry[] = [
  { symbol: "FOREXCOM:SPXUSD", label: "S&P 500" },
  { symbol: "DJ:DJI",          label: "DJIA" },
  { symbol: "NASDAQ:NDX",      label: "NASDAQ 100" },
  { symbol: "CBOE:VIX",        label: "VIX" },
];

const ENERGY: TickerEntry[] = [
  { symbol: "NYMEX:CL1!", label: "WTI Crude" },
  { symbol: "NYMEX:BZ1!", label: "Brent Crude" },
  { symbol: "COMEX:GC1!", label: "Gold" },
  { symbol: "COMEX:SI1!", label: "Silver" },
];

// Major ex-US equity indices — the global picture (Tokyo / HK / China / London / EU).
const GLOBAL: TickerEntry[] = [
  { symbol: "TVC:NI225",  label: "Nikkei 225 (Tokyo)" },
  { symbol: "TVC:HSI",    label: "Hang Seng (HK)" },
  { symbol: "TVC:SHCOMP", label: "Shanghai Composite" },
  { symbol: "TVC:UKX",    label: "FTSE 100 (London)" },
  { symbol: "TVC:DAX",    label: "DAX (Frankfurt)" },
  { symbol: "TVC:SX5E",   label: "Euro Stoxx 50" },
];

// Rates, FX, and a growth proxy (copper) — where macro trends actually show up.
const RATES_FX: TickerEntry[] = [
  { symbol: "TVC:DXY",    label: "US Dollar Index" },
  { symbol: "TVC:US10Y",  label: "US 10Y Yield" },
  { symbol: "TVC:US02Y",  label: "US 2Y Yield" },
  { symbol: "FX:USDJPY",  label: "USD/JPY" },
  { symbol: "FX:USDCNH",  label: "USD/CNH" },
  { symbol: "FX:EURUSD",  label: "EUR/USD" },
  { symbol: "FX:GBPUSD",  label: "GBP/USD" },
  { symbol: "COMEX:HG1!", label: "Copper" },
];

const TICKER_TAPE_DEFAULT = [
  { proName: "FOREXCOM:SPXUSD", title: "S&P 500" },
  { proName: "DJ:DJI",          title: "DOW" },
  { proName: "NASDAQ:NDX",      title: "NASDAQ" },
  { proName: "TVC:NI225",       title: "Nikkei" },
  { proName: "TVC:HSI",         title: "Hang Seng" },
  { proName: "TVC:UKX",         title: "FTSE" },
  { proName: "TVC:DXY",         title: "DXY" },
  { proName: "TVC:US10Y",       title: "US 10Y" },
  { proName: "NYMEX:CL1!",      title: "WTI Oil" },
  { proName: "COMEX:GC1!",      title: "Gold" },
  { proName: "CBOE:VIX",        title: "VIX" },
];

function buildTickerCfg(extraTickers: TickerEntry[]): string {
  return JSON.stringify({
    symbols: [
      ...TICKER_TAPE_DEFAULT,
      ...extraTickers.slice(0, 6).map((t) => ({ proName: t.symbol, title: t.label })),
    ],
    showSymbolLogo: false,
    colorTheme: "dark",
    isTransparent: true,
    displayMode: "adaptive",
    locale: "en",
  });
}

function buildOverviewCfg(watchlist: TickerEntry[]): string {
  return JSON.stringify({
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
        title: "Watchlist",
        symbols: watchlist.map((t) => ({ s: t.symbol, d: t.label })),
        originalTitle: "Watchlist",
      },
      {
        title: "Indices",
        symbols: INDICES.map((t) => ({ s: t.symbol, d: t.label })),
        originalTitle: "Indices",
      },
      {
        title: "Global",
        symbols: GLOBAL.map((t) => ({ s: t.symbol, d: t.label })),
        originalTitle: "Global",
      },
      {
        title: "Rates & FX",
        symbols: RATES_FX.map((t) => ({ s: t.symbol, d: t.label })),
        originalTitle: "Rates & FX",
      },
      {
        title: "Energy & Metals",
        symbols: ENERGY.map((t) => ({ s: t.symbol, d: t.label })),
        originalTitle: "Energy",
      },
    ],
  });
}

// Economic calendar (CPI, rate decisions, jobs, GDP) across the major economies.
function buildEventsCfg(): string {
  return JSON.stringify({
    colorTheme: "dark",
    isTransparent: true,
    width: "100%",
    height: 460,
    locale: "en",
    importanceFilter: "0,1",            // medium + high importance only
    countryFilter: "us,eu,jp,cn,gb,de,fr,kr,in",
  });
}

// TradingView widget mount. Inner div is required for the TV script to inject
// its iframe; the script reads its config from the textContent of the script
// element via document.currentScript.
function TVWidget({ widgetType, configJson, height, keyVer }: {
  widgetType: string; configJson: string; height?: number; keyVer: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.className = "tradingview-widget-container";
    if (height) container.style.height = `${height}px`;
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    inner.style.width = "100%";
    container.appendChild(inner);
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${widgetType}.js`;
    script.async = true;
    script.appendChild(document.createTextNode(configJson));
    container.appendChild(script);
    return () => {
      container.innerHTML = "";
      container.removeAttribute("style");
      container.className = "";
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyVer, configJson]);

  return <div ref={ref} />;
}

function formatUpdated(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function MarketsTab({ articles = [] }: { articles?: NewsItem[] }) {
  const [watchlist, setWatchlist] = useState<TickerEntry[]>([]);
  const [widgetKey, setWidgetKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());

  useEffect(() => {
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }) => setWatchlist(prefs?.marketsWatchlist ?? []))
      .catch(() => {});
  }, []);

  const tickerCfg = useMemo(() => buildTickerCfg(watchlist), [watchlist]);
  const overviewCfg = useMemo(() => buildOverviewCfg(watchlist), [watchlist]);
  const eventsCfg = useMemo(() => buildEventsCfg(), []);

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
            <p className="text-[10px] text-slate-600 font-mono">
              {watchlist.length} watchlist · global indices · rates &amp; FX · econ calendar · DOD contracts
            </p>
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
        <TVWidget widgetType="ticker-tape" configJson={tickerCfg} keyVer={widgetKey} />
      </div>

      {/* AI macro brief (news-driven) */}
      <MacroBriefPanel articles={articles} />

      {/* Market overview (with user's watchlist as first tab) */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden" style={{ height: 540 }}>
        <TVWidget widgetType="market-overview" configJson={overviewCfg} height={540} keyVer={widgetKey} />
      </div>

      {/* Economic calendar — CPI, central-bank decisions, jobs, GDP across major economies */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5 px-1">
          Economic calendar
        </p>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden" style={{ height: 460 }}>
          <TVWidget widgetType="events" configJson={eventsCfg} height={460} keyVer={widgetKey} />
        </div>
      </div>

      {/* DOD contract awards feed */}
      <ContractsPanel />

      {/* Empty-state hint when watchlist is the defaults-only state */}
      {watchlist.length === 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <p className="text-[10px] text-slate-500 font-mono">
            Add tickers to your watchlist in <span className="text-emerald-400">Preferences → Markets Watchlist</span>.
          </p>
        </div>
      )}

      <p className="text-[10px] text-slate-700 text-right">
        Market data by{" "}
        <a href="https://www.tradingview.com" target="_blank" rel="noopener noreferrer"
          className="text-slate-600 hover:text-slate-400 underline">TradingView</a>
        {" · contracts via "}
        <a href="https://www.defense.gov/News/Contracts/" target="_blank" rel="noopener noreferrer"
          className="text-slate-600 hover:text-slate-400 underline">defense.gov</a>
      </p>
    </div>
  );
}
