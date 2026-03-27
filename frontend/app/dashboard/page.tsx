"use client";

import { useState, useEffect, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ─── Config ───────────────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Market hours ─────────────────────────────────────────────────────────────
// NYSE/NASDAQ: Mon–Fri 09:30–16:00 US Eastern time
function getMarketStatus(): { open: boolean; label: string; note: string } {
  const now = new Date();
  // Convert to US Eastern (UTC-5 standard / UTC-4 daylight)
  const etOffset = isDST(now) ? -4 : -5;
  const et = new Date(now.getTime() + (etOffset - now.getTimezoneOffset() / 60) * 3600_000);
  const day = et.getDay(); // 0=Sun, 6=Sat
  const minutes = et.getHours() * 60 + et.getMinutes();
  const open = day >= 1 && day <= 5 && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  const label = open ? "Market open" : "Market closed";
  const note = open
    ? "Live quotes are current"
    : "Quotes are from last session · arbitrage signals may not reflect real opportunities";
  return { open, label, note };
}

function isDST(d: Date): boolean {
  // DST in the US: second Sunday of March through first Sunday of November
  const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(d.getFullYear(), 6, 1).getTimezoneOffset();
  return d.getTimezoneOffset() < Math.max(jan, jul);
}

// ─── Tickers ──────────────────────────────────────────────────────────────────
const WATCHED = ["AAPL", "TSLA", "NVDA", "QQQ"];
const BENCHMARKS = ["SPY", "DJI"];
const ALL_TICKERS = [...WATCHED, ...BENCHMARKS];

// ─── Types ────────────────────────────────────────────────────────────────────

type AlphaScore = {
  ticker: string;
  score: number; // -1.0 to 1.0
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number; // 0–100
  alpha_30d: number; // annualised excess return vs SPY, 30-day window
  alpha_90d: number; // annualised excess return vs SPY, 90-day window
  sharpe: number; // risk-adjusted return (rf = 5%)
  momentum_14d: number; // 14-day rate-of-change
};

type AlphaResponse = {
  timestamp: string;
  scores: AlphaScore[];
};

type Decision = {
  id: string;
  ticker: string;
  action: "BUY" | "SELL" | "HOLD";
  status: "executed" | "pending" | "rejected";
  signalType: string;       // alpha | slippage_window | price_divergence | hft_window
  score: number;            // composite 0–1
  alphaSignal: number;      // normalised alpha contribution 0–1
  arbConfidence: number;    // arbitrage confidence 0–1
  detail: string;           // human-readable reason from the signal detector
  blockedReason: string | null;
  timestamp: string;
};

type DecisionsResponse = {
  decisions: Decision[];
};

type OptimizerInsight = {
  param: string;
  current: number;
  suggested: number;
  delta: string;
  impact: "high" | "medium" | "low";
};

type OptimizerResponse = {
  epoch: number;
  sharpe: number;
  win_rate: number;
  avg_return: number;
  insights: OptimizerInsight[];
  last_updated: string;
};

type RiskMetric = {
  ticker: string;
  var_1d: number; // Value at Risk (1-day)
  exposure: number; // 0–100 %
  volatility: number; // annualised %
  beta: number;
  alert: boolean;
};

type RiskResponse = {
  portfolio_var: number;
  max_drawdown: number;
  correlation_risk: "low" | "medium" | "high";
  metrics: RiskMetric[];
  timestamp: string;
};

type FeedbackPayload = {
  ticker: string;
  decision_id: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string;
};

type LiveQuote = {
  ticker: string;
  price: number;
  bid: number;
  ask: number;
  volume_delta: number;
  timestamp: string;
};

type HistoricalPrice = {
  ticker: string;
  date: string;
  close: number;
};

// ─── Mock Data ────────────────────────────────────────────────────────────────

function mockOptimizer(): OptimizerResponse {
  return {
    epoch: Math.floor(Math.random() * 1000) + 200,
    sharpe: parseFloat((1.2 + Math.random() * 0.8).toFixed(3)),
    win_rate: parseFloat((52 + Math.random() * 15).toFixed(1)),
    avg_return: parseFloat((0.3 + Math.random() * 0.9).toFixed(2)),
    insights: [
      {
        param: "lookback_period",
        current: 14,
        suggested: 21,
        delta: "+7",
        impact: "high",
      },
      {
        param: "stop_loss_pct",
        current: 2.5,
        suggested: 1.8,
        delta: "-0.7%",
        impact: "medium",
      },
      {
        param: "position_size",
        current: 0.1,
        suggested: 0.12,
        delta: "+0.02",
        impact: "medium",
      },
      {
        param: "entry_threshold",
        current: 0.25,
        suggested: 0.3,
        delta: "+0.05",
        impact: "low",
      },
    ],
    last_updated: new Date().toISOString(),
  };
}

function mockRisk(): RiskResponse {
  return {
    portfolio_var: parseFloat((Math.random() * 3 + 1).toFixed(2)),
    max_drawdown: parseFloat((Math.random() * 8 + 2).toFixed(2)),
    correlation_risk: ["low", "medium", "high"][
      Math.floor(Math.random() * 3)
    ] as "low" | "medium" | "high",
    metrics: ALL_TICKERS.map((ticker) => ({
      ticker,
      var_1d: parseFloat((Math.random() * 2.5 + 0.5).toFixed(2)),
      exposure: parseFloat((Math.random() * 30 + 5).toFixed(1)),
      volatility: parseFloat((Math.random() * 40 + 10).toFixed(1)),
      beta: parseFloat((Math.random() * 1.5 + 0.5).toFixed(2)),
      alert: Math.random() > 0.7,
    })),
    timestamp: new Date().toISOString(),
  };
}

// ─── API Helpers (swap mock → fetch here) ─────────────────────────────────────

async function getAlpha(): Promise<AlphaResponse> {
  try {
    const raw: Array<{
      ticker: string;
      alpha_30d: number;
      alpha_90d: number;
      sharpe: number;
      momentum_14d: number;
    }> = await (await fetch(`${API_BASE}/alpha`)).json();
    if (!Array.isArray(raw))
      return { timestamp: new Date().toISOString(), scores: [] };
    return {
      timestamp: new Date().toISOString(),
      scores: raw.map((r) => {
        const a30 = r.alpha_30d ?? 0;
        const a90 = r.alpha_90d ?? 0;
        const sharpe = r.sharpe ?? 0;
        const m = r.momentum_14d ?? 0;
        const score = Math.max(-1, Math.min(1, a30));
        const signal: "BUY" | "SELL" | "HOLD" =
          a30 > 0.05 ? "BUY" : a30 < -0.05 ? "SELL" : "HOLD";
        const directionAgree = Math.sign(a30) === Math.sign(a90) ? 40 : 10;
        const sharpeBoost = sharpe > 0 ? Math.min(40, sharpe * 20) : 0;
        const momentumBoost = Math.abs(m) > 0.02 ? 20 : 10;
        const confidence = Math.round(
          Math.min(100, directionAgree + sharpeBoost + momentumBoost),
        );
        return {
          ticker: r.ticker,
          score,
          signal,
          confidence,
          alpha_30d: a30,
          alpha_90d: a90,
          sharpe,
          momentum_14d: m,
        };
      }),
    };
  } catch {
    return { timestamp: new Date().toISOString(), scores: [] };
  }
}

async function getDecisions(): Promise<DecisionsResponse> {
  try {
    const raw: Array<{
      id: string;
      ticker: string;
      score: number;
      type: string;
      alpha_signal: number;
      arb_confidence: number;
      detail: string;
      status: string;
      blocked_reason: string | null;
      timestamp: string;
    }> = await (await fetch(`${API_BASE}/decisions`)).json();
    if (!Array.isArray(raw)) return { decisions: [] };
    return {
      decisions: raw.map((r) => {
        const action: "BUY" | "SELL" | "HOLD" =
          r.status === "blocked" ? "HOLD" : r.score > 0 ? "BUY" : "SELL";
        const status: "executed" | "pending" | "rejected" =
          r.status === "approved" ? "executed" : r.status === "blocked" ? "rejected" : "pending";
        return {
          id: r.id,
          ticker: r.ticker,
          action,
          status,
          signalType: r.type ?? "unknown",
          score: r.score ?? 0,
          alphaSignal: r.alpha_signal ?? 0,
          arbConfidence: r.arb_confidence ?? 0,
          detail: r.detail ?? "",
          blockedReason: r.blocked_reason ?? null,
          timestamp: r.timestamp,
        };
      }),
    };
  } catch {
    return { decisions: [] };
  }
}

async function getLiveQuotes(ticker?: string): Promise<LiveQuote[]> {
  try {
    const url = ticker
      ? `${API_BASE}/data/quotes?ticker=${ticker}`
      : `${API_BASE}/data/quotes`;
    const raw: Array<Record<string, unknown>> = await (await fetch(url)).json();
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => ({
      ticker: String(r.ticker ?? ""),
      price: Number(r.price ?? r.close ?? 0),
      bid: Number(r.bid ?? 0),
      ask: Number(r.ask ?? 0),
      volume_delta: Number(r.volume_delta ?? r.volume ?? 0),
      timestamp: String(r.timestamp ?? r.time ?? ""),
    }));
  } catch {
    return [];
  }
}

async function getHistoricalPrices(
  ticker?: string,
  days = 90,
): Promise<HistoricalPrice[]> {
  try {
    const params = new URLSearchParams({ days: String(days) });
    if (ticker) params.set("ticker", ticker);
    const raw: Array<Record<string, unknown>> = await (
      await fetch(`${API_BASE}/data/prices?${params}`)
    ).json();
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => ({
      ticker: String(r.ticker ?? ""),
      date: String(r.date ?? r.time ?? r.timestamp ?? "").slice(0, 10),
      close: Number(r.close ?? 0),
    }));
  } catch {
    return [];
  }
}

async function getOptimizer(): Promise<OptimizerResponse> {
  // SWAP: return (await fetch(`${API_BASE}/optimizer`)).json();
  return mockOptimizer();
}

async function getRisk(): Promise<RiskResponse> {
  // SWAP: return (await fetch(`${API_BASE}/risk`)).json();
  return mockRisk();
}

async function postFeedback(payload: FeedbackPayload): Promise<void> {
  // SWAP: await fetch(`${API_BASE}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  console.log("[feedback submitted]", payload);
}

// ─── Shared Primitives ────────────────────────────────────────────────────────

function PulsingDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {active && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex rounded-full h-2 w-2 ${active ? "bg-emerald-400" : "bg-zinc-600"}`}
      />
    </span>
  );
}

function Badge({
  label,
  variant,
}: {
  label: string;
  variant:
    | "buy"
    | "sell"
    | "hold"
    | "executed"
    | "pending"
    | "rejected"
    | "high"
    | "medium"
    | "low";
}) {
  const map: Record<string, string> = {
    buy: "bg-emerald-900/50 text-emerald-300 border-emerald-800",
    sell: "bg-red-900/50 text-red-300 border-red-800",
    hold: "bg-zinc-800 text-zinc-300 border-zinc-700",
    executed: "bg-emerald-900/50 text-emerald-300 border-emerald-800",
    pending: "bg-amber-900/50 text-amber-300 border-amber-800",
    rejected: "bg-red-900/50 text-red-300 border-red-800",
    high: "bg-red-900/50 text-red-300 border-red-800",
    medium: "bg-amber-900/50 text-amber-300 border-amber-800",
    low: "bg-sky-900/50 text-sky-300 border-sky-800",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${map[variant] ?? map.hold}`}
    >
      {label}
    </span>
  );
}

function MiniBar({
  value,
  max = 100,
  color = "bg-emerald-500",
}: {
  value: number;
  max?: number;
  color?: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}


function PanelShell({
  title,
  subtitle,
  live,
  maxHeight = "480px",
  children,
}: {
  title: string;
  subtitle?: string;
  live?: boolean;
  maxHeight?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <div>
          <h2 className="text-sm font-bold text-white tracking-wide">
            {title}
          </h2>
          {subtitle && (
            <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <PulsingDot active={!!live} />
          <span className="text-[10px] text-zinc-500">
            {live ? "LIVE" : "IDLE"}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ maxHeight }}>{children}</div>
    </div>
  );
}

// ─── Panel 1: Alpha Scores + Live Quotes + Price History ─────────────────────

type AlphaTab = "scores" | "live" | "history";

const ALPHA_GLOSSARY = [
  {
    term: "Alpha (30d / 90d)",
    formula: "annualised(ticker return) − annualised(SPY return)",
    explain:
      "How much the stock beat or lagged the S&P 500 benchmark. Positive = outperforming. Calculated over a 30-day and 90-day rolling window. If both windows agree in direction the signal is more reliable.",
  },
  {
    term: "Sharpe ratio",
    formula:
      "(annualised daily return − 5% risk-free rate) ÷ annualised daily volatility",
    explain:
      "Risk-adjusted return. Above 1.0 is good, above 2.0 is excellent. Negative means the stock doesn't compensate for its own risk after the risk-free rate.",
  },
  {
    term: "14d Momentum",
    formula: "(close today − close 14 days ago) ÷ close 14 days ago",
    explain:
      "Rate-of-change over the last 14 trading days. Positive = price trending up. Used as a secondary confirmation signal alongside alpha.",
  },
  {
    term: "Confidence %",
    formula:
      "direction agreement (40) + Sharpe boost (0–40) + momentum boost (10–20)",
    explain:
      "0–100 score summarising how consistent the signals are. 40 pts if 30d and 90d alpha point the same direction, up to 40 pts for positive Sharpe, up to 20 pts for strong momentum.",
  },
  {
    term: "BUY / SELL / HOLD",
    formula: "alpha_30d > +5% → BUY · < −5% → SELL · else HOLD",
    explain:
      "Directional signal derived from the 30-day alpha. Not a trade order — it is the agent's interpretation of whether the stock is currently outperforming or underperforming SPY.",
  },
];

function AlphaPanel() {
  const [tab, setTab] = useState<AlphaTab>("scores");
  const [showGuide, setShowGuide] = useState(false);
  const [data, setData] = useState<AlphaResponse | null>(null);
  const [quotes, setQuotes] = useState<LiveQuote[]>([]);
  const [prices, setPrices] = useState<HistoricalPrice[]>([]);

  useEffect(() => {
    const tick = async () => setData(await getAlpha());
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (tab !== "live") return;
    const tick = async () => setQuotes(await getLiveQuotes());
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [tab]);

  useEffect(() => {
    if (tab !== "history") return;
    const tick = async () => setPrices(await getHistoricalPrices());
    tick();
  }, [tab]);

  const sharpeColor = (v: number) =>
    v >= 1 ? "text-emerald-400" : v >= 0 ? "text-zinc-300" : "text-red-400";
  const sharpeLabel = (v: number) =>
    v >= 2 ? "excellent" : v >= 1 ? "good" : v >= 0 ? "weak" : "negative";
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  // Build recharts series: one line per ticker, x-axis = date
  const chartData = (() => {
    const byDate = new Map<string, Record<string, number>>();
    for (const p of prices) {
      if (!byDate.has(p.date))
        byDate.set(p.date, { date: p.date as unknown as number });
      byDate.get(p.date)![p.ticker] = p.close;
    }
    return Array.from(byDate.values()).sort((a, b) =>
      String(a.date) < String(b.date) ? -1 : 1,
    );
  })();
  const chartTickers = [...new Set(prices.map((p) => p.ticker))];
  const lineColors: Record<string, string> = {
    AAPL: "#34d399",
    TSLA: "#f87171",
    NVDA: "#60a5fa",
    QQQ: "#fbbf24",
  };

  const tabBtn = (t: AlphaTab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-md transition-all ${
        tab === t
          ? "bg-zinc-700 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <PanelShell
      title="Alpha Scores"
      subtitle="How much each ticker beats or lags SPY (annualised, rf = 5%)"
      live
    >
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-800/60">
        {tabBtn("scores", "Alpha")}
        {tabBtn("live", "Live Quotes")}
        {tabBtn("history", "Price History")}
        <button
          onClick={() => setShowGuide((v) => !v)}
          className={`ml-auto px-2 py-1 text-[10px] font-bold rounded-md border transition-all ${
            showGuide
              ? "border-zinc-600 text-zinc-200 bg-zinc-800"
              : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
          }`}
          title="How to read this panel"
        >
          ? How to read
        </button>
      </div>

      {/* ── Glossary guide ── */}
      {showGuide && (
        <div className="border-b border-zinc-800/60 bg-zinc-900/60 px-4 py-3 flex flex-col gap-3">
          <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-widest">
            How numbers are calculated
          </p>
          {ALPHA_GLOSSARY.map((g) => (
            <div key={g.term}>
              <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
                <span className="text-[11px] font-bold text-zinc-200">
                  {g.term}
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  {g.formula}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                {g.explain}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab: Alpha Scores ── */}
      {tab === "scores" && (
        <>
          <div className="flex flex-col divide-y divide-zinc-800/60">
            {(data?.scores ?? []).map((s) => {
              const isPos = s.alpha_30d >= 0;
              const barColor =
                s.signal === "BUY"
                  ? "bg-emerald-500"
                  : s.signal === "SELL"
                    ? "bg-red-500"
                    : "bg-zinc-600";
              const trendAgree =
                Math.sign(s.alpha_30d) === Math.sign(s.alpha_90d);
              return (
                <div key={s.ticker} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-mono font-bold text-zinc-100 w-10 shrink-0">
                      {s.ticker}
                    </span>
                    <span
                      title={
                        s.signal === "BUY"
                          ? "Positive alpha — outperforming SPY"
                          : s.signal === "SELL"
                            ? "Negative alpha — underperforming SPY"
                            : "Alpha near zero — no clear edge vs SPY"
                      }
                    >
                      <Badge
                        label={s.signal}
                        variant={
                          s.signal.toLowerCase() as "buy" | "sell" | "hold"
                        }
                      />
                    </span>
                    <span
                      className="text-[10px] text-zinc-500 ml-auto"
                      title="Confidence: based on 30d/90d alpha direction agreement + positive Sharpe + momentum. Higher = more consistent signal."
                    >
                      {s.confidence}% conf
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-2 mb-1.5"
                    title={`30-day alpha: ${s.ticker} returned ${pct(s.alpha_30d)} more/less than SPY annualised over 30 days`}
                  >
                    <span className="text-[10px] text-zinc-600 w-16 shrink-0">
                      vs SPY 30d
                    </span>
                    <MiniBar
                      value={Math.abs(s.alpha_30d) * 100}
                      max={50}
                      color={barColor}
                    />
                    <span
                      className={`text-[10px] font-mono font-bold w-14 text-right shrink-0 ${isPos ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {pct(s.alpha_30d)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-x-2 text-[10px] font-mono">
                    <span
                      className="text-zinc-500"
                      title="90-day alpha vs SPY. If 30d and 90d agree in direction, the signal is more reliable."
                    >
                      90d alpha{" "}
                      <span
                        className={
                          s.alpha_90d >= 0 ? "text-emerald-400" : "text-red-400"
                        }
                      >
                        {pct(s.alpha_90d)}
                      </span>
                    </span>
                    <span
                      className="text-zinc-500"
                      title={`Sharpe = (annualised return − 5% rf) ÷ volatility. Above 1.0 is good. This is ${sharpeLabel(s.sharpe)}.`}
                    >
                      Sharpe{" "}
                      <span className={sharpeColor(s.sharpe)}>
                        {s.sharpe.toFixed(2)}
                      </span>
                    </span>
                    <span
                      className="text-zinc-500"
                      title={`Price changed ${pct(s.momentum_14d)} over the last 14 trading days. Positive = upward trend.`}
                    >
                      14d mom{" "}
                      <span
                        className={
                          s.momentum_14d >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }
                      >
                        {pct(s.momentum_14d)}
                      </span>
                    </span>
                  </div>
                  {!trendAgree && (
                    <div
                      className="mt-1.5 text-[10px] text-amber-500"
                      title="30d and 90d alpha point in opposite directions — short-term trend may be reversing."
                    >
                      ⚠ mixed signal — 30d and 90d alpha disagree
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="px-4 pb-2 border-t border-zinc-800/60 pt-2">
            <p className="text-[10px] text-zinc-600">
              Updated{" "}
              {data ? new Date(data.timestamp).toLocaleTimeString() : "—"} ·
              polling 2s · alpha = annualised ticker return − SPY return
            </p>
          </div>
        </>
      )}

      {/* ── Tab: Live Quotes ── */}
      {tab === "live" && (
        <div className="p-3">
          {quotes.length === 0 ? (
            <p className="text-[11px] text-zinc-600 text-center py-6">
              No live quotes — waiting for data…
            </p>
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-zinc-600 text-[10px] uppercase tracking-widest">
                  <th className="text-left pb-2">Ticker</th>
                  <th className="text-right pb-2" title="Latest trade price">
                    Price
                  </th>
                  <th
                    className="text-right pb-2"
                    title="Best bid (highest buy offer)"
                  >
                    Bid
                  </th>
                  <th
                    className="text-right pb-2"
                    title="Best ask (lowest sell offer)"
                  >
                    Ask
                  </th>
                  <th
                    className="text-right pb-2"
                    title="Ask − Bid spread in dollars"
                  >
                    Spread
                  </th>
                  <th
                    className="text-right pb-2"
                    title="Volume delta: buy volume minus sell volume"
                  >
                    Vol Δ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {quotes.map((q) => {
                  const spread = q.ask - q.bid;
                  return (
                    <tr key={q.ticker} className="text-zinc-300">
                      <td className="py-1.5 font-bold text-zinc-100">
                        {q.ticker}
                      </td>
                      <td className="text-right">${q.price.toFixed(2)}</td>
                      <td className="text-right text-emerald-400">
                        ${q.bid.toFixed(2)}
                      </td>
                      <td className="text-right text-red-400">
                        ${q.ask.toFixed(2)}
                      </td>
                      <td className="text-right text-zinc-500">
                        {spread > 0 ? `$${spread.toFixed(3)}` : "—"}
                      </td>
                      <td
                        className={`text-right ${q.volume_delta >= 0 ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {q.volume_delta >= 0 ? "+" : ""}
                        {q.volume_delta.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="text-[10px] text-zinc-600 mt-3">
            Polling every 3s · bid/ask from DB
          </p>
        </div>
      )}

      {/* ── Tab: Price History ── */}
      {tab === "history" && (
        <div className="p-3">
          {chartData.length === 0 ? (
            <p className="text-[11px] text-zinc-600 text-center py-6">
              No historical prices — waiting for data…
            </p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={chartData}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                >
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#52525b", fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: string) => v.slice(5)}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: "#52525b", fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `$${v}`}
                    width={42}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                    labelStyle={{ color: "#a1a1aa" }}
                    formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, ""]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: "#71717a" }} />
                  {chartTickers.map((t) => (
                    <Line
                      key={t}
                      type="monotone"
                      dataKey={t}
                      stroke={lineColors[t] ?? "#94a3b8"}
                      dot={false}
                      strokeWidth={1.5}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <p className="text-[10px] text-zinc-600 mt-2">
                90-day close prices · source: Vincent&apos;s DB
              </p>
            </>
          )}
        </div>
      )}
    </PanelShell>
  );
}

const SIGNAL_TYPE_LABELS: Record<string, { label: string; explain: string }> = {
  alpha: {
    label: "Alpha",
    explain:
      "Based on annualised outperformance vs SPY. BUY = ticker beating the market; SELL = lagging.",
  },
  slippage_window: {
    label: "Slippage Window",
    explain:
      "The bid-ask spread narrowed to less than 66% of its 20-tick rolling average — a low-friction window to enter or exit cheaply.",
  },
  price_divergence: {
    label: "Price Divergence",
    explain:
      "Two correlated tickers (e.g. AAPL/QQQ) have drifted apart by more than 2 standard deviations — mean-reversion arbitrage opportunity.",
  },
  hft_window: {
    label: "HFT Window",
    explain:
      "Volume delta spiked >2σ above average AND spread compressed >10% simultaneously — short-lived high-frequency trading window.",
  },
};

const DECISION_GLOSSARY = [
  {
    term: "BUY / SELL / HOLD",
    explain:
      "BUY = positive alpha or approved arbitrage opportunity. SELL = negative alpha (underperforming SPY). HOLD = signal was blocked by the Senso risk gate and no action is taken.",
  },
  {
    term: "Executed",
    explain:
      "The decision passed all Senso risk checks (score ≥ 0.3 and random risk gate). In a live system this would trigger a trade order. Here it means the agent approved the opportunity.",
  },
  {
    term: "Rejected",
    explain:
      "Senso blocked the decision — either the score was below 0.3 or the probabilistic risk gate fired. No trade is taken.",
  },
  {
    term: "Score",
    explain:
      "Composite signal strength: 40% × alpha signal + 60% × arbitrage confidence. Range 0–1. Higher = stronger combined signal.",
  },
  {
    term: "Alpha signal",
    explain:
      "Normalised 30-day alpha contribution (0–1). 0 means the alpha was zero or negative; 1 means it was the strongest alpha in the current batch.",
  },
  {
    term: "Arb confidence",
    explain:
      "How strong the arbitrage pattern is (0–1). For spread narrowing: how far below the rolling average. For z-score divergence: how many σ above 2.0.",
  },
  {
    term: "Signal detail",
    explain:
      "The exact numbers from the signal detector — spread values, z-scores, volume spikes — so you can verify the raw reason behind each decision.",
  },
];

// ─── Panel 2: Decision Log Feed ───────────────────────────────────────────────

function DecisionLog() {
  const [data, setData] = useState<DecisionsResponse | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [market, setMarket] = useState(getMarketStatus);
  const prevIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const id = setInterval(() => setMarket(getMarketStatus()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const tick = async () => {
      const d = await getDecisions();
      const newIds = new Set(d.decisions.map((x) => x.id));
      const added = d.decisions.find((x) => !prevIds.current.has(x.id));
      if (added) {
        setFlash(added.id);
        setTimeout(() => setFlash(null), 1200);
      }
      prevIds.current = newIds;
      setData(d);
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <PanelShell
      title="Decision Log"
      subtitle="Scored opportunities after Senso risk gate · updated every 5s"
      maxHeight="560px"
      live
    >
      {/* How-to-read toggle */}
      <div className="flex items-center px-3 py-2 border-b border-zinc-800/60">
        <button
          onClick={() => setShowGuide((v) => !v)}
          className={`ml-auto px-2 py-1 text-[10px] font-bold rounded-md border transition-all ${
            showGuide ? "border-zinc-600 text-zinc-200 bg-zinc-800" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
          }`}
        >
          ? How to read
        </button>
      </div>

      {/* Glossary */}
      {showGuide && (
        <div className="border-b border-zinc-800/60 bg-zinc-900/60 px-4 py-3 flex flex-col gap-2.5">
          <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-widest">How to read decisions</p>
          {DECISION_GLOSSARY.map((g) => (
            <div key={g.term}>
              <span className="text-[11px] font-bold text-zinc-200">{g.term} — </span>
              <span className="text-[11px] text-zinc-400 leading-relaxed">{g.explain}</span>
            </div>
          ))}
        </div>
      )}

      {/* Market closed warning */}
      {!market.open && (
        <div className="px-4 py-2 bg-amber-950/40 border-b border-amber-800/40 flex items-start gap-2">
          <span className="text-amber-400 text-xs shrink-0 mt-0.5">⚠</span>
          <p className="text-[11px] text-amber-400/80 leading-relaxed">
            <span className="font-bold">Market is closed.</span> The agent is still running but live quotes are from the last session — arbitrage signals (Slippage Window, HFT Window, Price Divergence) may not reflect real opportunities. Alpha scores are unaffected.
          </p>
        </div>
      )}

      {/* Decision rows */}
      <div className="flex flex-col divide-y divide-zinc-800/60">
        {(data?.decisions ?? []).map((dec) => {
          const sig = SIGNAL_TYPE_LABELS[dec.signalType] ?? { label: dec.signalType, explain: "" };
          return (
            <div
              key={dec.id}
              className={`px-4 py-3 transition-colors duration-700 ${flash === dec.id ? "bg-emerald-950/40" : ""}`}
            >
              {/* Row 1: ticker · action · status · time */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono font-bold text-zinc-100 w-14 shrink-0">{dec.ticker}</span>
                <span title={dec.action === "BUY" ? "Positive signal — agent recommends entering a long position" : dec.action === "SELL" ? "Negative alpha — agent recommends avoiding or exiting" : "Signal blocked — no trade taken"}>
                  <Badge label={dec.action} variant={dec.action.toLowerCase() as "buy" | "sell" | "hold"} />
                </span>
                <span title={dec.status === "executed" ? "Passed all Senso risk checks — would trigger a trade in a live system" : dec.status === "rejected" ? "Blocked by Senso risk gate — score too low or probabilistic risk check failed" : "Awaiting evaluation"}>
                  <Badge label={dec.status} variant={dec.status} />
                </span>
                <span className="ml-auto text-[10px] text-zinc-500 font-mono" title="Time this decision was generated">
                  {new Date(dec.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {/* Row 2: signal type pill + score bar */}
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 shrink-0"
                  title={sig.explain}
                >
                  {sig.label}
                </span>
                <div className="flex-1 flex items-center gap-1.5" title={`Score = 40% × alpha signal (${(dec.alphaSignal * 100).toFixed(0)}%) + 60% × arb confidence (${(dec.arbConfidence * 100).toFixed(0)}%) = ${dec.score.toFixed(3)}`}>
                  <MiniBar value={dec.score * 100} max={100} color={dec.score > 0.5 ? "bg-emerald-500" : "bg-amber-500"} />
                  <span className="text-[10px] font-mono font-bold text-zinc-300 shrink-0">{dec.score.toFixed(3)}</span>
                </div>
              </div>

              {/* Row 3: alpha signal + arb confidence breakdown */}
              <div className="grid grid-cols-2 gap-x-3 text-[10px] font-mono mb-1.5">
                <span className="text-zinc-500" title="Normalised alpha signal (0–1). How strongly this ticker's 30-day alpha contributed to the score.">
                  Alpha sig <span className={dec.alphaSignal > 0 ? "text-emerald-400" : "text-zinc-500"}>{(dec.alphaSignal * 100).toFixed(0)}%</span>
                </span>
                <span className="text-zinc-500" title="Arbitrage confidence (0–1). Strength of the spread/divergence/volume signal.">
                  Arb conf <span className={dec.arbConfidence > 0 ? "text-sky-400" : "text-zinc-500"}>{(dec.arbConfidence * 100).toFixed(0)}%</span>
                </span>
              </div>

              {/* Row 4: signal detail or block reason */}
              {dec.blockedReason ? (
                <p className="text-[11px] text-red-400/80 leading-relaxed" title="Why Senso blocked this decision">
                  Blocked — {dec.blockedReason}
                </p>
              ) : (
                dec.detail && (
                  <p className="text-[11px] text-zinc-500 leading-relaxed" title="Raw signal details from the detector">
                    {dec.detail}
                  </p>
                )
              )}

              {/* Row 5: decision ID */}
              <p className="text-[10px] font-mono text-zinc-700 mt-1">{dec.id}</p>
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-2 border-t border-zinc-800/60 pt-2">
        <p className="text-[10px] text-zinc-600">
          Score = 40% alpha signal + 60% arb confidence · Senso gates each decision · polling 3s
        </p>
      </div>
    </PanelShell>
  );
}

// ─── Panel 3: Overmind Learning Panel ─────────────────────────────────────────

function OptimizerPanel() {
  const [data, setData] = useState<OptimizerResponse | null>(null);

  useEffect(() => {
    const tick = async () => {
      setData(await getOptimizer());
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <PanelShell
      title="Overmind Learning"
      subtitle="Optimizer epoch & parameter suggestions"
      live
    >
      {data && (
        <>
          {/* Stats bar */}
          <div className="grid grid-cols-3 divide-x divide-zinc-800 border-b border-zinc-800/60">
            {[
              {
                label: "Sharpe",
                value: data.sharpe.toFixed(3),
                color: "text-emerald-400",
              },
              {
                label: "Win Rate",
                value: `${data.win_rate.toFixed(1)}%`,
                color: "text-sky-400",
              },
              {
                label: "Avg Ret",
                value: `${data.avg_return.toFixed(2)}%`,
                color: "text-amber-400",
              },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center py-3">
                <span className={`text-lg font-mono font-bold ${s.color}`}>
                  {s.value}
                </span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
          {/* Epoch */}
          <div className="px-4 py-2 flex items-center justify-between border-b border-zinc-800/60">
            <span className="text-[11px] text-zinc-500">Epoch</span>
            <span className="text-sm font-mono text-white">
              {data.epoch.toLocaleString()}
            </span>
          </div>
          {/* Insights */}
          <div className="flex flex-col divide-y divide-zinc-800/60">
            {data.insights.map((ins) => (
              <div
                key={ins.param}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono text-zinc-300">
                      {ins.param}
                    </span>
                    <Badge label={ins.impact} variant={ins.impact} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-zinc-500">{ins.current}</span>
                    <span className="text-zinc-600">→</span>
                    <span className="text-emerald-400 font-bold">
                      {ins.suggested}
                    </span>
                    <span className="text-amber-400">({ins.delta})</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 pb-3">
            <p className="text-[10px] text-zinc-600">
              Last updated {new Date(data.last_updated).toLocaleTimeString()} ·
              polling 5s
            </p>
          </div>
        </>
      )}
    </PanelShell>
  );
}

// ─── Panel 4: Senso Risk Panel ─────────────────────────────────────────────────

function RiskPanel() {
  const [data, setData] = useState<RiskResponse | null>(null);

  useEffect(() => {
    const tick = async () => setData(await getRisk());
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  const corrColor: Record<string, string> = {
    low: "text-emerald-400",
    medium: "text-amber-400",
    high: "text-red-400",
  };

  return (
    <PanelShell
      title="Senso Risk"
      subtitle="Portfolio risk exposure & alerts"
      live={!!data}
    >
      {data && (
        <>
          {/* Portfolio summary */}
          <div className="grid grid-cols-3 divide-x divide-zinc-800 border-b border-zinc-800/60">
            {[
              {
                label: "Portfolio VaR",
                value: `${data.portfolio_var.toFixed(2)}%`,
                color: "text-red-400",
              },
              {
                label: "Max Drawdown",
                value: `${data.max_drawdown.toFixed(2)}%`,
                color: "text-orange-400",
              },
              {
                label: "Corr Risk",
                value: data.correlation_risk.toUpperCase(),
                color: corrColor[data.correlation_risk],
              },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center py-3">
                <span className={`text-base font-mono font-bold ${s.color}`}>
                  {s.value}
                </span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
          {/* Per-ticker rows */}
          <div className="p-3 flex flex-col gap-2.5">
            {data.metrics.map((m) => (
              <div key={m.ticker}>
                <div className="flex items-center gap-2 mb-1">
                  {m.alert && (
                    <span className="text-[9px] font-bold text-red-400 border border-red-800 bg-red-900/30 rounded px-1 py-0.5">
                      ⚠ ALERT
                    </span>
                  )}
                  <span className="text-xs font-mono font-bold text-zinc-200">
                    {m.ticker}
                  </span>
                  <span className="text-[10px] text-zinc-500 ml-auto">
                    β {m.beta.toFixed(2)} · vol {m.volatility.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 w-16 shrink-0">
                    {m.exposure.toFixed(1)}% exp
                  </span>
                  <MiniBar
                    value={m.exposure}
                    max={40}
                    color={
                      m.alert
                        ? "bg-red-500"
                        : m.exposure > 20
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                    }
                  />
                  <span className="text-[10px] text-zinc-500 shrink-0">
                    VaR {m.var_1d.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 pb-2">
            <p className="text-[10px] text-zinc-600">
              {new Date(data.timestamp).toLocaleTimeString()} · polling 3s
            </p>
          </div>
        </>
      )}
    </PanelShell>
  );
}

// ─── Panel 5: Trader Feedback Input ──────────────────────────────────────────

function FeedbackPanel() {
  const [ticker, setTicker] = useState<string>(WATCHED[0]);
  const [decisionId, setDecisionId] = useState("");
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  const handleSubmit = async () => {
    if (!decisionId.trim()) return;
    setStatus("sending");
    try {
      await postFeedback({ ticker, decision_id: decisionId, rating, comment });
      setStatus("sent");
      setDecisionId("");
      setComment("");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2500);
    }
  };

  const stars = [1, 2, 3, 4, 5] as const;

  return (
    <PanelShell
      title="Trader Feedback"
      subtitle="Rate and annotate agent decisions"
    >
      <div className="p-4 flex flex-col gap-4">
        {/* Ticker select */}
        <div>
          <label className="text-[11px] text-zinc-500 uppercase tracking-widest block mb-1.5">
            Ticker
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {ALL_TICKERS.map((t) => (
              <button
                key={t}
                onClick={() => setTicker(t)}
                className={`px-2.5 py-1 rounded-md text-xs font-mono font-bold border transition-all ${
                  ticker === t
                    ? "bg-zinc-100 text-black border-zinc-100"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Decision ID */}
        <div>
          <label className="text-[11px] text-zinc-500 uppercase tracking-widest block mb-1.5">
            Decision ID
          </label>
          <input
            type="text"
            value={decisionId}
            onChange={(e) => setDecisionId(e.target.value)}
            placeholder="dec_1234567890_0"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
          />
        </div>

        {/* Star rating */}
        <div>
          <label className="text-[11px] text-zinc-500 uppercase tracking-widest block mb-1.5">
            Rating
          </label>
          <div className="flex gap-2">
            {stars.map((s) => (
              <button
                key={s}
                onClick={() => setRating(s)}
                className={`text-xl transition-all ${
                  s <= rating
                    ? "text-amber-400 scale-110"
                    : "text-zinc-700 hover:text-zinc-500"
                }`}
              >
                ★
              </button>
            ))}
            <span className="text-xs text-zinc-500 self-center ml-1">
              {rating}/5
            </span>
          </div>
        </div>

        {/* Comment */}
        <div>
          <label className="text-[11px] text-zinc-500 uppercase tracking-widest block mb-1.5">
            Comment
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Entry was well-timed; consider tighter stop on volatile names…"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors resize-none"
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={status === "sending" || !decisionId.trim()}
          className={`w-full py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
            status === "sent"
              ? "bg-emerald-600 text-white"
              : status === "error"
                ? "bg-red-700 text-white"
                : status === "sending"
                  ? "bg-zinc-700 text-zinc-400 cursor-wait"
                  : "bg-white text-black hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed"
          }`}
        >
          {status === "sending"
            ? "Submitting…"
            : status === "sent"
              ? "✓ Feedback sent"
              : status === "error"
                ? "✗ Error — retry"
                : "Submit Feedback"}
        </button>
      </div>
    </PanelShell>
  );
}

// ─── Agent Dashboard Root ─────────────────────────────────────────────────────

export default function AgentDashboard() {
  const [market, setMarket] = useState(getMarketStatus);

  useEffect(() => {
    const id = setInterval(() => setMarket(getMarketStatus()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="w-full bg-black min-h-screen py-6 px-4 sm:px-6 lg:px-8 font-sans">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">
              Overmind Agent Console
            </h1>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Tickers: {WATCHED.join(", ")} · Benchmarks:{" "}
              {BENCHMARKS.join(", ")}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {/* Market status */}
            <span
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-widest ${
                market.open
                  ? "border-emerald-800 bg-emerald-950/50 text-emerald-400"
                  : "border-zinc-700 bg-zinc-900 text-zinc-500"
              }`}
              title={market.note}
            >
              <PulsingDot active={market.open} />
              {market.label}
            </span>
            <div className="flex items-center gap-1.5">
              <PulsingDot active />
              <span className="text-[11px] text-zinc-400">Agent running</span>
            </div>
          </div>
        </div>
      </div>

      {/* 5-Panel Grid */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Row 1: Alpha (tall) + Decision Log (tall) */}
        <AlphaPanel />
        <div className="md:col-span-1 xl:col-span-1">
          <DecisionLog />
        </div>
        {/* Row 2: Optimizer + Risk + Feedback */}
        <OptimizerPanel />
        <RiskPanel />
        <FeedbackPanel />
      </div>
    </div>
  );
}
