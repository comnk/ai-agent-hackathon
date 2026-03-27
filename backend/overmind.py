"""
Overmind — QuantMind self-improvement engine.

Provides the `record(decision, outcome)` function that Xiao's decision engine
calls after each trade cycle to log results and drive continuous optimisation.

Usage:
    from overmind import record
    record(decision, outcome)
"""

from __future__ import annotations

import asyncio
import logging

from core.config import settings

logger = logging.getLogger(__name__)


def record(decision: dict, outcome: dict) -> None:
    """
    Log a completed decision and its outcome for learning.

    Parameters
    ----------
    decision : dict
        Must contain: id, ticker, score, type, status, blocked_reason, timestamp
        (matches GET /decisions item shape from Xiao's module)

    outcome : dict
        Must contain: profitable (bool), delta (float), cycle (int)
    """
    try:
        asyncio.get_event_loop().run_until_complete(
            _record_async(decision, outcome)
        )
    except RuntimeError:
        asyncio.run(_record_async(decision, outcome))


async def _record_async(decision: dict, outcome: dict) -> None:
    """Async implementation of the record function."""
    from core.decision_log import save_decision_record, update_optimizer_metrics
    from core.overclaw_runner import run_optimize_async

    ticker = decision.get("ticker", "UNKNOWN")
    decision_id = decision.get("id", "unknown")
    cycle = outcome.get("cycle", 0)
    profitable = outcome.get("profitable", False)
    delta = outcome.get("delta", 0.0)

    # ── Step 1: write to SQLite decision log ────────────────────────
    try:
        await save_decision_record(decision, outcome)
        logger.info(
            "overmind.record | %s %s cycle=%d profitable=%s delta=%.4f",
            decision_id,
            ticker,
            cycle,
            profitable,
            delta,
        )
    except Exception:
        logger.exception("Failed to save decision record for %s", decision_id)

    # ── Step 2: upload outcome to Senso KB (strategy memory) ────────
    try:
        from core.senso_client import upload_raw

        text = (
            f"# Decision Outcome: {decision_id}\n"
            f"- Ticker: {ticker}\n"
            f"- Type: {decision.get('type', 'unknown')}\n"
            f"- Score: {decision.get('score', 0)}\n"
            f"- Status: {decision.get('status', 'unknown')}\n"
            f"- Profitable: {profitable}\n"
            f"- Delta: {delta}\n"
            f"- Cycle: {cycle}\n"
        )
        if decision.get("blocked_reason"):
            text += f"- Blocked reason: {decision['blocked_reason']}\n"

        await upload_raw(f"outcome-{decision_id}-cycle{cycle}", text)
    except Exception:
        logger.warning(
            "Failed to upload outcome to Senso KB for %s (non-critical)",
            decision_id,
        )

    # ── Step 3: update optimizer metrics ────────────────────────────
    try:
        await update_optimizer_metrics(decision, outcome)
    except Exception:
        logger.exception("Failed to update optimizer metrics")

    # ── Step 4: trigger Overclaw optimisation if threshold reached ──
    if cycle > 0 and cycle % settings.overclaw_optimize_every_n == 0:
        logger.info(
            "Cycle %d reached — triggering Overclaw background optimisation",
            cycle,
        )
        run_optimize_async()
