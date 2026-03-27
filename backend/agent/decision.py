"""Autonomous agent loop: merges alpha + arbitrage signals into ranked decisions."""
import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.analysis.alpha import compute_alpha_scores
from backend.analysis.arbitrage import detect_arbitrage_opportunities
from backend.senso import check as senso_check
from backend.overmind import record as overmind_record

TICKERS_WATCHED = ["AAPL", "TSLA", "NVDA", "QQQ"]
LOOP_INTERVAL = 5  # seconds

# Module-level state (read by the API router)
latest_decisions: list[dict[str, Any]] = []
latest_alpha: list[dict[str, Any]] = []
latest_arbitrage: list[dict[str, Any]] = []
agent_status: dict[str, Any] = {
    "running": False,
    "last_run": None,
    "cycle_count": 0,
    "tickers_watched": TICKERS_WATCHED,
}

_task: asyncio.Task | None = None


def _build_unified_opportunities(
    alpha_scores: list[dict], arb_opps: list[dict]
) -> list[dict[str, Any]]:
    """Merge alpha and arbitrage signals into a single opportunity list."""
    unified: list[dict[str, Any]] = []

    # Alpha signals — only positive alpha contributes; normalise to [0,1]
    max_alpha = max((a["alpha_30d"] for a in alpha_scores), default=1) or 1
    for a in alpha_scores:
        alpha_signal = min(1.0, max(0.0, a["alpha_30d"] / max_alpha))
        unified.append({
            "ticker": a["ticker"],
            "type": "alpha",
            "alpha_signal": alpha_signal,
            "arb_confidence": 0.0,
            "sharpe": a["sharpe"],
            "momentum_14d": a["momentum_14d"],
            "detail": f"Alpha30d={a['alpha_30d']:.4f}, Sharpe={a['sharpe']:.2f}",
        })

    # Arbitrage signals
    for opp in arb_opps:
        unified.append({
            "ticker": opp["ticker"],
            "type": opp["type"],
            "alpha_signal": 0.0,
            "arb_confidence": opp["confidence"],
            "sharpe": 0.0,
            "momentum_14d": 0.0,
            "detail": opp["detail"],
        })

    return unified


def _score(opp: dict[str, Any]) -> float:
    """Weighted score: 40 % alpha signal + 60 % arbitrage confidence."""
    return round(0.40 * opp["alpha_signal"] + 0.60 * opp["arb_confidence"], 6)


_decision_counter = 0


def _next_id() -> str:
    """Generate a sequential decision ID."""
    global _decision_counter
    _decision_counter += 1
    return f"dec_{_decision_counter:04d}"


async def _run_cycle() -> None:
    """Execute one full decision cycle and update module-level state."""
    loop = asyncio.get_event_loop()
    alpha_scores = await loop.run_in_executor(None, compute_alpha_scores)
    arb_opps = await loop.run_in_executor(None, detect_arbitrage_opportunities)

    latest_alpha.clear()
    latest_alpha.extend(alpha_scores)
    latest_arbitrage.clear()
    latest_arbitrage.extend(arb_opps)

    opportunities = _build_unified_opportunities(alpha_scores, arb_opps)

    cycle_decisions: list[dict[str, Any]] = []

    for opp in opportunities:
        score = _score(opp)
        decision: dict[str, Any] = {
            "id": _next_id(),
            "ticker": opp["ticker"],
            "score": score,
            "type": opp["type"],
            "alpha_signal": opp["alpha_signal"],
            "arb_confidence": opp["arb_confidence"],
            "detail": opp["detail"],
            "status": "approved",
            "blocked_reason": None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        # Risk gate
        gate_input = {**opp, "score": score}
        if senso_check(gate_input):
            decision["status"] = "approved"
        else:
            decision["status"] = "blocked"
            decision["blocked_reason"] = "senso risk gate rejected"

        outcome = {"score": score, "detail": opp["detail"]}
        overmind_record(decision, outcome)

        cycle_decisions.append(decision)

    # Rank by score descending, then update in place so imported references stay valid
    cycle_decisions.sort(key=lambda d: d["score"], reverse=True)
    latest_decisions.clear()
    latest_decisions.extend(cycle_decisions)


async def agent_loop() -> None:
    """Run the decision agent indefinitely, cycling every LOOP_INTERVAL seconds."""
    agent_status["running"] = True
    while True:
        try:
            await _run_cycle()
            agent_status["cycle_count"] += 1
            agent_status["last_run"] = datetime.now(timezone.utc).isoformat()
        except Exception as exc:
            print(f"[decision] cycle error: {exc}")
        await asyncio.sleep(LOOP_INTERVAL)


def start_agent() -> None:
    """Schedule the agent loop as a background asyncio task."""
    global _task
    if _task is None or _task.done():
        loop = asyncio.get_event_loop()
        _task = loop.create_task(agent_loop())
