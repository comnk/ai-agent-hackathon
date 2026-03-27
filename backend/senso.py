"""
Senso — QuantMind risk guardrail.

Provides the `check(opportunity)` function that Xiao's decision engine calls
before executing any trade. Returns True if the trade is within risk
parameters, False if it should be blocked.

Usage:
    from senso import check
    safe = check(opportunity)  # opportunity matches GET /arbitrage shape
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


def check(opportunity: dict) -> bool:
    """
    Evaluate whether an opportunity is within risk parameters.

    Parameters
    ----------
    opportunity : dict
        Must contain: ticker, type, confidence, timestamp, detail
        (matches GET /arbitrage item shape from Xiao's module)

    Returns
    -------
    bool
        True if the opportunity is safe to trade, False if it should be blocked.
    """
    try:
        return asyncio.get_event_loop().run_until_complete(_check_async(opportunity))
    except RuntimeError:
        # No event loop running — create a new one
        return asyncio.run(_check_async(opportunity))


async def _check_async(opportunity: dict) -> bool:
    """Async implementation of the risk check."""
    from agents.quantmind_agent import run as run_agent
    from core.decision_log import log_senso_event

    ticker = opportunity.get("ticker", "UNKNOWN")
    opp_type = opportunity.get("type", "unknown")
    confidence = opportunity.get("confidence", 0.0)
    detail = opportunity.get("detail", "")

    # ── Step 1: query Senso KB for relevant risk rules ──────────────
    risk_context = ""
    try:
        from core.senso_client import search_context

        query = (
            f"Risk check for {ticker} {opp_type} trade with "
            f"confidence {confidence}. {detail}"
        )
        chunks = await search_context(query, max_results=5)
        risk_context = "\n".join(
            chunk.get("chunk_text", "") for chunk in chunks
        )
    except Exception:
        logger.warning(
            "Senso KB search failed for %s — falling back to agent without KB context",
            ticker,
        )

    # ── Step 2: run the Overclaw-optimised agent ────────────────────
    agent_input = {
        "ticker": ticker,
        "type": opp_type,
        "confidence": confidence,
        "detail": detail,
        "risk_context": risk_context,
    }
    result = run_agent(agent_input)

    verdict = result.get("verdict", "block")
    reason = result.get("reason", "No reason provided")

    # ── Step 3: log the decision ────────────────────────────────────
    try:
        await log_senso_event(opportunity, verdict=verdict, reason=reason)
    except Exception:
        logger.exception("Failed to log senso event")

    logger.info(
        "senso.check | %s %s conf=%.2f → %s (%s)",
        ticker,
        opp_type,
        confidence,
        verdict,
        reason,
    )

    return verdict == "allow"
