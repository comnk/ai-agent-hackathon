"""Read/write helpers for the decision log and optimizer state in SQLite."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.models import DecisionLog, OptimizerState, StrategyHistory

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Senso — write check results
# ---------------------------------------------------------------------------

async def log_senso_event(
    opportunity: dict,
    verdict: str,
    reason: str,
) -> None:
    """Write a senso.check() result to the decision log."""
    async with async_session() as session:
        entry = DecisionLog(
            ticker=opportunity.get("ticker", "UNKNOWN"),
            opportunity_type=opportunity.get("type", "unknown"),
            confidence=opportunity.get("confidence", 0.0),
            detail=opportunity.get("detail"),
            action="allowed" if verdict == "allow" else "blocked",
            reason=reason,
        )
        session.add(entry)
        await session.commit()


# ---------------------------------------------------------------------------
# Overmind — record decision outcome
# ---------------------------------------------------------------------------

async def save_decision_record(decision: dict, outcome: dict) -> None:
    """Update or create a decision log entry with outcome data from overmind.record()."""
    async with async_session() as session:
        # Try to find an existing log entry for this decision's ticker and recent time
        entry = DecisionLog(
            ticker=decision.get("ticker", "UNKNOWN"),
            opportunity_type=decision.get("type", "unknown"),
            confidence=decision.get("score", 0.0),
            detail=f"decision_id={decision.get('id')}",
            action=decision.get("status", "approved"),
            reason=decision.get("blocked_reason"),
            decision_id=decision.get("id"),
            profitable=outcome.get("profitable"),
            delta=outcome.get("delta"),
            cycle=outcome.get("cycle"),
        )
        session.add(entry)
        await session.commit()


# ---------------------------------------------------------------------------
# Optimizer metrics
# ---------------------------------------------------------------------------

async def update_optimizer_metrics(decision: dict, outcome: dict) -> None:
    """Recompute and store optimizer metrics after a new outcome is recorded."""
    async with async_session() as session:
        # Get current state
        state = await _get_or_create_state(session)
        state.cycle_count = outcome.get("cycle", state.cycle_count)
        await session.commit()

        # Compute running metrics from all recorded outcomes
        result = await session.execute(
            select(DecisionLog).where(DecisionLog.profitable.isnot(None))
        )
        rows = result.scalars().all()

        if not rows:
            return

        # Alpha accuracy: fraction of "allowed" decisions that were profitable
        allowed = [r for r in rows if r.action == "allowed"]
        alpha_acc = (
            sum(1 for r in allowed if r.profitable) / len(allowed) if allowed else 0.0
        )

        # Arbitrage hit rate: fraction of all recorded outcomes that were profitable
        arb_hit = sum(1 for r in rows if r.profitable) / len(rows) if rows else 0.0

        # Risk score: fraction of blocked trades (lower = less risk exposure)
        total = len(rows) + len([r for r in rows if r.action == "blocked"])
        blocked_count = len([r for r in rows if r.action == "blocked"])
        risk_sc = blocked_count / total if total else 0.0

        history = StrategyHistory(
            cycle=outcome.get("cycle", 0),
            alpha_accuracy=round(alpha_acc, 4),
            arbitrage_hit_rate=round(arb_hit, 4),
            risk_score=round(risk_sc, 4),
            update_summary=f"Cycle {outcome.get('cycle')}: alpha_acc={alpha_acc:.2f}, arb_hit={arb_hit:.2f}",
        )
        session.add(history)
        await session.commit()


# ---------------------------------------------------------------------------
# GET /risk helpers
# ---------------------------------------------------------------------------

async def get_recent_events(limit: int = 20) -> list[dict]:
    """Return most recent decision log entries formatted for GET /risk."""
    async with async_session() as session:
        result = await session.execute(
            select(DecisionLog).order_by(desc(DecisionLog.created_at)).limit(limit)
        )
        rows = result.scalars().all()
        return [
            {
                "ticker": r.ticker,
                "action": r.action,
                "reason": r.reason or "Within risk parameters",
                "timestamp": r.created_at.isoformat() + "Z" if r.created_at else None,
            }
            for r in rows
        ]


async def get_risk_level() -> str:
    """
    Compute risk level from recent decisions.
    - block rate < 20% → green
    - block rate 20–50% → yellow
    - block rate > 50% → red
    """
    async with async_session() as session:
        result = await session.execute(
            select(DecisionLog).order_by(desc(DecisionLog.created_at)).limit(20)
        )
        rows = result.scalars().all()
        if not rows:
            return "green"
        blocked = sum(1 for r in rows if r.action == "blocked")
        rate = blocked / len(rows)
        if rate > 0.5:
            return "red"
        elif rate > 0.2:
            return "yellow"
        return "green"


# ---------------------------------------------------------------------------
# GET /optimizer helpers
# ---------------------------------------------------------------------------

async def get_cycle_count() -> int:
    async with async_session() as session:
        state = await _get_or_create_state(session)
        return state.cycle_count


async def get_optimizer_metrics() -> dict:
    """Return metrics with cycle_1 baseline and current values."""
    async with async_session() as session:
        # Get first recorded history
        first_result = await session.execute(
            select(StrategyHistory).order_by(StrategyHistory.cycle).limit(1)
        )
        first = first_result.scalar_one_or_none()

        # Get latest recorded history
        latest_result = await session.execute(
            select(StrategyHistory).order_by(desc(StrategyHistory.cycle)).limit(1)
        )
        latest = latest_result.scalar_one_or_none()

        if not first or not latest:
            return {
                "alpha_accuracy": {"cycle_1": 0.0, "current": 0.0},
                "arbitrage_hit_rate": {"cycle_1": 0.0, "current": 0.0},
                "risk_score": {"cycle_1": 0.0, "current": 0.0},
            }

        return {
            "alpha_accuracy": {
                "cycle_1": first.alpha_accuracy or 0.0,
                "current": latest.alpha_accuracy or 0.0,
            },
            "arbitrage_hit_rate": {
                "cycle_1": first.arbitrage_hit_rate or 0.0,
                "current": latest.arbitrage_hit_rate or 0.0,
            },
            "risk_score": {
                "cycle_1": first.risk_score or 0.0,
                "current": latest.risk_score or 0.0,
            },
        }


async def get_recent_updates() -> list[str]:
    """Return recent update summaries (from DB + overclaw report if available)."""
    updates: list[str] = []

    # From Overclaw report.md if it exists
    report_path = (
        Path(__file__).resolve().parent.parent
        / ".overclaw"
        / "agents"
        / "quantmind"
        / "experiments"
        / "report.md"
    )
    if report_path.exists():
        lines = report_path.read_text().splitlines()
        # Extract bullet points from report
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("- ") or stripped.startswith("* "):
                updates.append(stripped.lstrip("-* ").strip())
            if len(updates) >= 3:
                break

    # From DB strategy history (latest summaries)
    async with async_session() as session:
        result = await session.execute(
            select(StrategyHistory)
            .where(StrategyHistory.update_summary.isnot(None))
            .order_by(desc(StrategyHistory.created_at))
            .limit(5)
        )
        rows = result.scalars().all()
        for r in rows:
            if r.update_summary and len(updates) < 8:
                updates.append(r.update_summary)

    # Also check optimizer_state.recent_updates JSON
    async with async_session() as session:
        state = await _get_or_create_state(session)
        if state.recent_updates:
            try:
                saved = json.loads(state.recent_updates)
                updates.extend(saved[:3])
            except (json.JSONDecodeError, TypeError):
                pass

    return updates[:10]


# ---------------------------------------------------------------------------
# POST /feedback helpers
# ---------------------------------------------------------------------------

async def save_feedback_update(summary: str) -> None:
    """Append a feedback-driven update to optimizer state."""
    async with async_session() as session:
        state = await _get_or_create_state(session)
        existing: list[str] = []
        if state.recent_updates:
            try:
                existing = json.loads(state.recent_updates)
            except (json.JSONDecodeError, TypeError):
                existing = []
        existing.insert(0, summary)
        state.recent_updates = json.dumps(existing[:20])
        await session.commit()


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

async def _get_or_create_state(session: AsyncSession) -> OptimizerState:
    result = await session.execute(select(OptimizerState).limit(1))
    state = result.scalar_one_or_none()
    if state is None:
        state = OptimizerState(id=1, cycle_count=0)
        session.add(state)
        await session.commit()
        await session.refresh(state)
    return state
