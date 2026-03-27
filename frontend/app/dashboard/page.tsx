"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Tickers ──────────────────────────────────────────────────────────────────
const WATCHED = ["AAPL", "TSLA", "NVDA", "QQQ"];
const BENCHMARKS = ["SPY", "DJI"];
const ALL_TICKERS = [...WATCHED, ...BENCHMARKS];

// ─── Types ────────────────────────────────────────────────────────────────────

type AlphaScore = {
  ticker: string;
  score: number;          // -1.0 to 1.0
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;     // 0–100
  momentum: number[];     // sparkline values
};

type AlphaResponse = {
  timestamp: string;
  scores: AlphaScore[];
};

type Decision = {
  id: string;
  ticker: string;
  action: "BUY" | "SELL" | "HOLD";
  quantity: number;
  price: number;
  rationale: string;
  timestamp: string;
  status: "executed" | "pending" | "rejected";
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
  var_1d: number;         // Value at Risk (1-day)
  exposure: number;       // 0–100 %
  volatility: number;     // annualised %
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

// ─── Mock Data ────────────────────────────────────────────────────────────────

function mockAlpha(): AlphaResponse {
  const signals: Array<"BUY" | "SELL" | "HOLD"> = ["BUY", "SELL", "HOLD"];
  return {
    timestamp: new Date().toISOString(),
    scores: ALL_TICKERS.map((ticker) => {
      const score = parseFloat((Math.random() * 2 - 1).toFixed(3));
      return {
        ticker,
        score,
        signal: score > 0.2 ? "BUY" : score < -0.2 ? "SELL" : "HOLD",
        confidence: Math.floor(50 + Math.random() * 50),
        momentum: Array.from({ length: 12 }, () =>
          parseFloat((Math.random() * 10 - 5).toFixed(2))
        ),
      };
    }),
  };
}

function mockDecisions(): DecisionsResponse {
  const actions: Array<"BUY" | "SELL" | "HOLD"> = ["BUY", "SELL", "HOLD"];
  const statuses: Array<"executed" | "pending" | "rejected"> = [
    "executed",
    "pending",
    "rejected",
  ];
  const rationales = [
    "Momentum breakout above 20-day EMA with volume confirmation.",
    "RSI overbought at 78; taking profit ahead of resistance.",
    "Consolidation phase; waiting for clearer directional signal.",
    "Macro tailwinds align with sector rotation into tech.",
    "Risk-off signal from VIX spike; reducing exposure.",
    "Earnings catalyst priced in; holding for continuation.",
  ];
  return {
    decisions: Array.from({ length: 8 }, (_, i) => ({
      id: `dec_${Date.now()}_${i}`,
      ticker: ALL_TICKERS[i % ALL_TICKERS.length],
      action: actions[Math.floor(Math.random() * actions.length)],
      quantity: Math.floor(Math.random() * 200) + 10,
      price: parseFloat((100 + Math.random() * 400).toFixed(2)),
      rationale: rationales[i % rationales.length],
      timestamp: new Date(Date.now() - i * 1000 * 60 * 2).toISOString(),
      status: statuses[Math.floor(Math.random() * statuses.length)],
    })),
  };
}

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
    const raw: Array<{ ticker: string; alpha_30d: number; alpha_90d: number; sharpe: number; momentum_14d: number }> =
      await (await fetch(`${API_BASE}/alpha`)).json();
    if (!Array.isArray(raw) || raw.length === 0) return mockAlpha();
    return {
      timestamp: new Date().toISOString(),
      scores: raw.map((r) => {
        const score = Math.max(-1, Math.min(1, r.alpha_30d ?? 0));
        const signal: "BUY" | "SELL" | "HOLD" = score > 0.1 ? "BUY" : score < -0.1 ? "SELL" : "HOLD";
        const confidence = Math.min(100, Math.max(0, Math.round(Math.abs(r.sharpe ?? 0) * 40)));
        const m = r.momentum_14d ?? 0;
        const momentum = Array.from({ length: 12 }, (_, i) => parseFloat((m * (0.5 + i / 12)).toFixed(3)));
        return { ticker: r.ticker, score, signal, confidence, momentum };
      }),
    };
  } catch {
    return mockAlpha();
  }
}

async function getDecisions(): Promise<DecisionsResponse> {
  try {
    const raw: Array<{ id: string; ticker: string; score: number; type: string; status: string; blocked_reason: string | null; timestamp: string }> =
      await (await fetch(`${API_BASE}/decisions`)).json();
    if (!Array.isArray(raw) || raw.length === 0) return mockDecisions();
    return {
      decisions: raw.map((r) => ({
        id: r.id,
        ticker: r.ticker,
        action: r.score > 0.5 ? "BUY" : r.score < 0.2 ? "SELL" : "HOLD" as "BUY" | "SELL" | "HOLD",
        quantity: Math.round(r.score * 100),
        price: 0,
        rationale: r.blocked_reason ?? `${r.type} signal · score ${r.score.toFixed(3)}`,
        timestamp: r.timestamp,
        status: r.status === "approved" ? "executed" : r.status === "blocked" ? "rejected" : "pending" as "executed" | "pending" | "rejected",
      })),
    };
  } catch {
    return mockDecisions();
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
  variant: "buy" | "sell" | "hold" | "executed" | "pending" | "rejected" | "high" | "medium" | "low";
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

function MiniBar({ value, max = 100, color = "bg-emerald-500" }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function MiniSparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const W = 48, H = 18;
  const xs = values.map((_, i) => (i / (values.length - 1)) * W);
  const ys = values.map((v) => H - ((v - min) / (max - min || 1)) * H);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0 opacity-80">
      <path d={d} fill="none" stroke={positive ? "#34d399" : "#f87171"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PanelShell({ title, subtitle, live, children }: { title: string; subtitle?: string; live?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <div>
          <h2 className="text-sm font-bold text-white tracking-wide">{title}</h2>
          {subtitle && <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          <PulsingDot active={!!live} />
          <span className="text-[10px] text-zinc-500">{live ? "LIVE" : "IDLE"}</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}

// ─── Panel 1: Live Ticker Chart (Alpha Scores) ────────────────────────────────

function AlphaPanel() {
  const [data, setData] = useState<AlphaResponse | null>(null);

  useEffect(() => {
    const tick = async () => setData(await getAlpha());
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <PanelShell title="Alpha Scores" subtitle="Signal strength across watched tickers" live>
      <div className="p-3 flex flex-col gap-2">
        {(data?.scores ?? []).map((s) => {
          const isPos = s.score >= 0;
          const barColor = s.signal === "BUY" ? "bg-emerald-500" : s.signal === "SELL" ? "bg-red-500" : "bg-zinc-600";
          return (
            <div key={s.ticker} className="flex items-center gap-3">
              <span className="text-xs font-mono font-bold text-zinc-200 w-10 shrink-0">{s.ticker}</span>
              <Badge label={s.signal} variant={s.signal.toLowerCase() as "buy" | "sell" | "hold"} />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`text-[10px] font-mono ${isPos ? "text-emerald-400" : "text-red-400"}`}>
                    {isPos ? "+" : ""}{s.score.toFixed(3)}
                  </span>
                  <span className="text-[10px] text-zinc-500">{s.confidence}% conf</span>
                </div>
                <MiniBar value={Math.abs(s.score) * 100} max={100} color={barColor} />
              </div>
              <MiniSparkline values={s.momentum} positive={isPos} />
            </div>
          );
        })}
      </div>
      <div className="px-3 pb-2">
        <p className="text-[10px] text-zinc-600">
          Updated {data ? new Date(data.timestamp).toLocaleTimeString() : "—"} · polling 2s
        </p>
      </div>
    </PanelShell>
  );
}

// ─── Panel 2: Decision Log Feed ───────────────────────────────────────────────

function DecisionLog() {
  const [data, setData] = useState<DecisionsResponse | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const prevIds = useRef<Set<string>>(new Set());

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
    <PanelShell title="Decision Log" subtitle="Overmind agent trade decisions" live>
      <div className="flex flex-col divide-y divide-zinc-800/60">
        {(data?.decisions ?? []).map((dec) => (
          <div
            key={dec.id}
            className={`px-4 py-3 transition-colors duration-700 ${flash === dec.id ? "bg-emerald-950/40" : ""}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono font-bold text-zinc-100">{dec.ticker}</span>
              <Badge label={dec.action} variant={dec.action.toLowerCase() as "buy" | "sell" | "hold"} />
              <Badge label={dec.status} variant={dec.status} />
              <span className="ml-auto text-[10px] text-zinc-500 font-mono">
                {new Date(dec.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="flex items-baseline gap-3 mb-1">
              <span className="text-sm font-mono font-bold text-white">
                ${dec.price.toFixed(2)}
              </span>
              <span className="text-[11px] text-zinc-400">× {dec.quantity} shares</span>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2">{dec.rationale}</p>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

// ─── Panel 3: Overmind Learning Panel ─────────────────────────────────────────

function OptimizerPanel() {
  const [data, setData] = useState<OptimizerResponse | null>(null);
  const [prev, setPrev] = useState<OptimizerResponse | null>(null);

  useEffect(() => {
    const tick = async () => {
      const d = await getOptimizer();
      setPrev((p) => p);
      setData(d);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <PanelShell title="Overmind Learning" subtitle="Optimizer epoch & parameter suggestions" live>
      {data && (
        <>
          {/* Stats bar */}
          <div className="grid grid-cols-3 divide-x divide-zinc-800 border-b border-zinc-800/60">
            {[
              { label: "Sharpe", value: data.sharpe.toFixed(3), color: "text-emerald-400" },
              { label: "Win Rate", value: `${data.win_rate.toFixed(1)}%`, color: "text-sky-400" },
              { label: "Avg Ret", value: `${data.avg_return.toFixed(2)}%`, color: "text-amber-400" },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center py-3">
                <span className={`text-lg font-mono font-bold ${s.color}`}>{s.value}</span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5">{s.label}</span>
              </div>
            ))}
          </div>
          {/* Epoch */}
          <div className="px-4 py-2 flex items-center justify-between border-b border-zinc-800/60">
            <span className="text-[11px] text-zinc-500">Epoch</span>
            <span className="text-sm font-mono text-white">{data.epoch.toLocaleString()}</span>
          </div>
          {/* Insights */}
          <div className="flex flex-col divide-y divide-zinc-800/60">
            {data.insights.map((ins) => (
              <div key={ins.param} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono text-zinc-300">{ins.param}</span>
                    <Badge label={ins.impact} variant={ins.impact} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-zinc-500">{ins.current}</span>
                    <span className="text-zinc-600">→</span>
                    <span className="text-emerald-400 font-bold">{ins.suggested}</span>
                    <span className="text-amber-400">({ins.delta})</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 pb-3">
            <p className="text-[10px] text-zinc-600">
              Last updated {new Date(data.last_updated).toLocaleTimeString()} · polling 5s
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
    <PanelShell title="Senso Risk" subtitle="Portfolio risk exposure & alerts" live={!!data}>
      {data && (
        <>
          {/* Portfolio summary */}
          <div className="grid grid-cols-3 divide-x divide-zinc-800 border-b border-zinc-800/60">
            {[
              { label: "Portfolio VaR", value: `${data.portfolio_var.toFixed(2)}%`, color: "text-red-400" },
              { label: "Max Drawdown", value: `${data.max_drawdown.toFixed(2)}%`, color: "text-orange-400" },
              {
                label: "Corr Risk",
                value: data.correlation_risk.toUpperCase(),
                color: corrColor[data.correlation_risk],
              },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center py-3">
                <span className={`text-base font-mono font-bold ${s.color}`}>{s.value}</span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5">{s.label}</span>
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
                  <span className="text-xs font-mono font-bold text-zinc-200">{m.ticker}</span>
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
                    color={m.alert ? "bg-red-500" : m.exposure > 20 ? "bg-amber-500" : "bg-emerald-500"}
                  />
                  <span className="text-[10px] text-zinc-500 shrink-0">VaR {m.var_1d.toFixed(2)}%</span>
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
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

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
    <PanelShell title="Trader Feedback" subtitle="Rate and annotate agent decisions">
      <div className="p-4 flex flex-col gap-4">
        {/* Ticker select */}
        <div>
          <label className="text-[11px] text-zinc-500 uppercase tracking-widest block mb-1.5">Ticker</label>
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
          <label className="text-[11px] text-zinc-500 uppercase tracking-widest block mb-1.5">Decision ID</label>
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
          <label className="text-[11px] text-zinc-500 uppercase tracking-widest block mb-1.5">Rating</label>
          <div className="flex gap-2">
            {stars.map((s) => (
              <button
                key={s}
                onClick={() => setRating(s)}
                className={`text-xl transition-all ${
                  s <= rating ? "text-amber-400 scale-110" : "text-zinc-700 hover:text-zinc-500"
                }`}
              >
                ★
              </button>
            ))}
            <span className="text-xs text-zinc-500 self-center ml-1">{rating}/5</span>
          </div>
        </div>

        {/* Comment */}
        <div>
          <label className="text-[11px] text-zinc-500 uppercase tracking-widest block mb-1.5">Comment</label>
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
  return (
    <div className="w-full bg-black min-h-screen py-6 px-4 sm:px-6 lg:px-8 font-sans">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Overmind Agent Console</h1>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Tickers: {WATCHED.join(", ")} · Benchmarks: {BENCHMARKS.join(", ")}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <PulsingDot active />
            <span className="text-[11px] text-zinc-400">All systems live</span>
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