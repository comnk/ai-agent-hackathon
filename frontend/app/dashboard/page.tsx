"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Navbar from "@/components/Navbar/Navbar";

// ─── Config ───────────────────────────────────────────────────────────────────
// Point this at your FastAPI server. In dev, FastAPI typically runs on :8000.
// In production, set NEXT_PUBLIC_API_URL in your .env
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Types & Data ─────────────────────────────────────────────────────────────

type Category = "index" | "stocks" | "crypto";

type Asset = {
    label: string;
    ticker: string;
    category: Category;
};

const ASSETS: Asset[] = [
    { label: "S&P 500", ticker: "^GSPC",   category: "index"  },
    { label: "NASDAQ",  ticker: "^IXIC",   category: "index"  },
    { label: "DOW",     ticker: "^DJI",    category: "index"  },
    { label: "VIX",     ticker: "^VIX",    category: "index"  },
    { label: "AAPL",    ticker: "AAPL",    category: "stocks" },
    { label: "MSFT",    ticker: "MSFT",    category: "stocks" },
    { label: "NVDA",    ticker: "NVDA",    category: "stocks" },
    { label: "GOOGL",   ticker: "GOOGL",   category: "stocks" },
    { label: "AMZN",    ticker: "AMZN",    category: "stocks" },
    { label: "META",    ticker: "META",    category: "stocks" },
    { label: "TSLA",    ticker: "TSLA",    category: "stocks" },
    { label: "JPM",     ticker: "JPM",     category: "stocks" },
    { label: "BTC",     ticker: "BTC-USD", category: "crypto" },
    { label: "ETH",     ticker: "ETH-USD", category: "crypto" },
    { label: "SOL",     ticker: "SOL-USD", category: "crypto" },
    { label: "BNB",     ticker: "BNB-USD", category: "crypto" },
    { label: "XRP",     ticker: "XRP-USD", category: "crypto" },
];

type Range = { label: string; interval: string; range: string };
const RANGES: Range[] = [
    { label: "1D",  interval: "5m",  range: "1d"  },
    { label: "5D",  interval: "60m", range: "5d"  },
    { label: "1M",  interval: "1d",  range: "1mo" },
    { label: "3M",  interval: "1d",  range: "3mo" },
    { label: "1Y",  interval: "1wk", range: "1y"  },
    { label: "5Y",  interval: "1mo", range: "5y"  },
];

const CAT_PILL: Record<Category, string> = {
    index:  "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    stocks: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    crypto: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

// ─── API Helpers ──────────────────────────────────────────────────────────────

type ChartPoint = { time: number; close: number };
type QuoteResult = { price: number; change: number; changePct: number; name: string };

async function fetchChart(ticker: string, interval: string, range: string): Promise<ChartPoint[]> {
    const res = await fetch(
        `${API_BASE}/api/market/chart?ticker=${encodeURIComponent(ticker)}&interval=${interval}&range=${range}`
    );
    if (!res.ok) throw new Error(`Chart fetch failed: ${res.status}`);
    const data = await res.json();
    return data.points as ChartPoint[];
}

async function fetchQuote(ticker: string): Promise<QuoteResult> {
    const res = await fetch(`${API_BASE}/api/market/quote?ticker=${encodeURIComponent(ticker)}`);
    if (!res.ok) throw new Error(`Quote fetch failed: ${res.status}`);
    return res.json();
}

// ─── Mini Sparkline ───────────────────────────────────────────────────────────

function Spark({ points, positive }: { points: number[]; positive: boolean }) {
    if (points.length < 2) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const W = 56, H = 22;
    const xs = points.map((_, i) => (i / (points.length - 1)) * W);
    const ys = points.map((v) => H - ((v - min) / (max - min || 1)) * H);
    const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
            <path d={d} fill="none" stroke={positive ? "#34d399" : "#f87171"}
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// ─── Chart.js Canvas ─────────────────────────────────────────────────────────

declare global { interface Window { Chart: any; } }

function useChartJs() {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (typeof window !== "undefined" && window.Chart) { setReady(true); return; }
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
        s.onload = () => setReady(true);
        document.head.appendChild(s);
    }, []);
    return ready;
}

function PriceChart({ points, category }: { points: ChartPoint[]; category: Category }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<any>(null);
    const chartReady = useChartJs();

    useEffect(() => {
        if (!chartReady || !canvasRef.current || points.length === 0) return;
        chartRef.current?.destroy();

        const isUp = points[points.length - 1].close >= points[0].close;
        const lineColor = isUp ? "#34d399" : "#f87171";
        const labels = points.map((p) =>
            new Date(p.time).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        );
        const ctx = canvasRef.current.getContext("2d")!;
        const gradient = ctx.createLinearGradient(0, 0, 0, 380);
        gradient.addColorStop(0, lineColor + "44");
        gradient.addColorStop(1, lineColor + "00");

        chartRef.current = new window.Chart(ctx, {
            type: "line",
            data: {
                labels,
                datasets: [{
                    data: points.map((p) => p.close),
                    borderColor: lineColor,
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: true,
                    tension: 0.3,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 500, easing: "easeInOutQuart" },
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "#18181b",
                        titleColor: "#a1a1aa",
                        bodyColor: "#f4f4f5",
                        borderColor: "#3f3f46",
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: (ctx: any) =>
                                ` $${ctx.parsed.y.toLocaleString("en-US", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                })}`,
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: "#71717a", font: { size: 11 }, maxTicksLimit: 8, maxRotation: 0 },
                        border: { display: false },
                    },
                    y: {
                        position: "right",
                        grid: { color: "#27272a44" },
                        ticks: {
                            color: "#71717a",
                            font: { size: 11 },
                            callback: (v: number) =>
                                v >= 1000 ? "$" + (v / 1000).toFixed(1) + "k" : "$" + v.toFixed(2),
                        },
                        border: { display: false },
                    },
                },
            },
        });

        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, [chartReady, points, category]);

    return <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />;
}

// ─── Sidebar Asset Card ───────────────────────────────────────────────────────

type CardData = QuoteResult & { sparks: number[] };

function AssetCard({ asset, active, onClick }: { asset: Asset; active: boolean; onClick: () => void }) {
    const [data, setData] = useState<CardData | null>(null);
    const [err, setErr] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setErr(false);
        Promise.all([fetchQuote(asset.ticker), fetchChart(asset.ticker, "1h", "5d")])
            .then(([q, pts]) => {
                if (!cancelled) setData({ ...q, sparks: pts.map((p) => p.close) });
            })
            .catch(() => { if (!cancelled) setErr(true); });
        return () => { cancelled = true; };
    }, [asset.ticker]);

    const pos = data ? data.changePct >= 0 : true;

    return (
        <button
            onClick={onClick}
            className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-left w-full transition-all
                ${active
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black"
                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                }`}
        >
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold">{asset.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold leading-none
                        ${active ? "bg-white/20 text-white dark:bg-black/20 dark:text-black" : CAT_PILL[asset.category]}`}>
                        {asset.category}
                    </span>
                </div>
                {data && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs font-mono">
                            ${data.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className={`text-[11px] font-semibold
                            ${active ? "opacity-60" : pos ? "text-emerald-500" : "text-red-400"}`}>
                            {pos ? "+" : ""}{data.changePct.toFixed(2)}%
                        </span>
                    </div>
                )}
                {!data && !err && <span className="text-[10px] text-zinc-400 animate-pulse">loading…</span>}
                {err && <span className="text-[10px] text-zinc-400">unavailable</span>}
            </div>
            {data && <Spark points={data.sparks} positive={pos} />}
        </button>
    );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
    const [selected, setSelected] = useState<Asset>(ASSETS[0]);
    const [range, setRange] = useState<Range>(RANGES[2]);
    const [filter, setFilter] = useState<Category | "all">("all");

    const [chartPoints, setChartPoints] = useState<ChartPoint[]>([]);
    const [chartLoading, setChartLoading] = useState(false);
    const [chartError, setChartError] = useState(false);
    const [headerQuote, setHeaderQuote] = useState<QuoteResult | null>(null);

    const load = useCallback(async () => {
        setChartLoading(true);
        setChartError(false);
        try {
            const [pts, q] = await Promise.all([
                fetchChart(selected.ticker, range.interval, range.range),
                fetchQuote(selected.ticker),
            ]);
            setChartPoints(pts);
            setHeaderQuote(q);
        } catch {
            setChartError(true);
        } finally {
            setChartLoading(false);
        }
    }, [selected.ticker, range]);

    useEffect(() => { load(); }, [load]);

    const filtered = filter === "all" ? ASSETS : ASSETS.filter((a) => a.category === filter);
    const isUp = headerQuote ? headerQuote.changePct >= 0 : true;

    const FilterBar = () => (
        <div className="flex gap-1 flex-wrap">
            {(["all", "index", "stocks", "crypto"] as const).map((cat) => (
                <button key={cat} onClick={() => setFilter(cat)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize transition-colors
                        ${filter === cat
                            ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                            : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}>
                    {cat === "all" ? "All" : { index: "Indices", stocks: "Stocks", crypto: "Crypto" }[cat]}
                </button>
            ))}
        </div>
    );

    return (
        <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black min-h-screen">
            <Navbar />
            <main className="flex flex-1 w-full max-w-7xl gap-5 py-24 px-4 sm:px-6 lg:px-8">

                {/* Sidebar */}
                <aside className="hidden lg:flex flex-col gap-2.5 w-64 shrink-0">
                    <FilterBar />
                    <div className="flex flex-col gap-1.5 overflow-y-auto" style={{ maxHeight: "calc(100vh - 180px)" }}>
                        {filtered.map((a) => (
                            <AssetCard key={a.ticker} asset={a}
                                active={selected.ticker === a.ticker}
                                onClick={() => setSelected(a)} />
                        ))}
                    </div>
                </aside>

                {/* Main panel */}
                <section className="flex-1 flex flex-col gap-4 min-w-0">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-2xl font-bold tracking-tight text-black dark:text-white">
                                    {selected.label}
                                </h1>
                                <span className={`text-xs px-2 py-0.5 rounded font-semibold ${CAT_PILL[selected.category]}`}>
                                    {selected.category}
                                </span>
                            </div>
                            {headerQuote && <p className="text-sm text-zinc-400 mt-0.5">{headerQuote.name}</p>}
                            {headerQuote && (
                                <div className="flex items-baseline gap-3 mt-2">
                                    <span className="text-4xl font-bold font-mono text-black dark:text-white">
                                        ${headerQuote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className={`text-lg font-semibold tabular-nums ${isUp ? "text-emerald-500" : "text-red-400"}`}>
                                        {isUp ? "▲" : "▼"} {Math.abs(headerQuote.change).toFixed(2)} ({isUp ? "+" : ""}{headerQuote.changePct.toFixed(2)}%)
                                    </span>
                                </div>
                            )}
                            {chartLoading && !headerQuote && (
                                <div className="mt-2 h-10 w-48 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                            )}
                        </div>

                        {/* Range pills */}
                        <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg p-1 self-start">
                            {RANGES.map((r) => (
                                <button key={r.label} onClick={() => setRange(r)}
                                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all
                                        ${range.label === r.label
                                            ? "bg-white dark:bg-zinc-700 text-black dark:text-white shadow-sm"
                                            : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                                        }`}>
                                    {r.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Chart */}
                    <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden"
                        style={{ height: 400 }}>
                        {chartLoading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-zinc-950/80 z-10">
                                <div className="flex flex-col items-center gap-3">
                                    <div className="w-7 h-7 border-2 border-zinc-300 dark:border-zinc-600 border-t-black dark:border-t-white rounded-full animate-spin" />
                                    <span className="text-xs text-zinc-400">Fetching {selected.label}…</span>
                                </div>
                            </div>
                        )}
                        {chartError && !chartLoading && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="text-center">
                                    <p className="text-zinc-400 text-sm">Failed to load chart data.</p>
                                    <p className="text-zinc-500 text-xs mt-1">Make sure your FastAPI server is running.</p>
                                    <button onClick={load} className="mt-2 text-xs underline text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                                        Try again
                                    </button>
                                </div>
                            </div>
                        )}
                        {!chartLoading && !chartError && chartPoints.length > 0 && (
                            <div className="absolute inset-0 p-4">
                                <PriceChart points={chartPoints} category={selected.category} />
                            </div>
                        )}
                    </div>

                    {/* Mobile grid */}
                    <div className="lg:hidden flex flex-col gap-3 mt-1">
                        <FilterBar />
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {filtered.map((a) => (
                                <AssetCard key={a.ticker} asset={a}
                                    active={selected.ticker === a.ticker}
                                    onClick={() => setSelected(a)} />
                            ))}
                        </div>
                    </div>

                    <p className="text-[11px] text-zinc-400">
                        Data via Yahoo Finance · Stocks/indices ~15 min delay · Crypto near real-time
                    </p>
                </section>
            </main>
        </div>
    );
}