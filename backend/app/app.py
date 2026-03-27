"""
QuantMind API — Senso + Overmind endpoints.

Endpoints:
    GET  /           Health check
    GET  /risk       Senso risk panel data (for Victor's frontend)
    GET  /optimizer  Overmind improvement metrics (for Victor's frontend)
    POST /feedback   Trader natural-language feedback (for Victor's frontend)
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s — %(message)s",
)
logger = logging.getLogger("quantmind")

app = FastAPI(title="QuantMind API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------


@app.on_event("startup")
async def startup() -> None:
    # Initialise the database tables
    from db.database import init_db

    await init_db()
    logger.info("Database initialised")

    # Ingest risk rules into Senso KB
    from core.senso_client import ingest_risk_rules

    await ingest_risk_rules()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@app.get("/")
async def root():
    return {"message": "QuantMind API running"}


# ---------------------------------------------------------------------------
# GET /risk — Senso risk panel
# ---------------------------------------------------------------------------


@app.get("/risk")
async def get_risk():
    """Return current risk level and recent Senso events."""
    from core.decision_log import get_recent_events, get_risk_level

    level = await get_risk_level()
    events = await get_recent_events(limit=20)
    return {"level": level, "recent_events": events}


# ---------------------------------------------------------------------------
# GET /optimizer — Overmind improvement metrics
# ---------------------------------------------------------------------------


@app.get("/optimizer")
async def get_optimizer():
    """Return cycle count, performance metrics, and recent strategy updates."""
    from core.decision_log import (
        get_cycle_count,
        get_optimizer_metrics,
        get_recent_updates,
    )

    cycle = await get_cycle_count()
    metrics = await get_optimizer_metrics()
    updates = await get_recent_updates()
    return {"cycle": cycle, "metrics": metrics, "recent_updates": updates}


# ---------------------------------------------------------------------------
# POST /feedback — Trader feedback
# ---------------------------------------------------------------------------


class FeedbackRequest(BaseModel):
    message: str


@app.post("/feedback")
async def post_feedback(body: FeedbackRequest):
    """
    Accept natural-language feedback from the trader.
    Updates the risk rules in Senso KB and the Overclaw policy.
    """
    message = body.message.strip()
    if not message:
        return {"status": "error", "summary": "Empty feedback message"}

    summary = await _apply_feedback(message)
    return {"status": "received", "summary": f"Overmind received: {summary}"}


async def _apply_feedback(message: str) -> str:
    """Parse feedback keywords and update risk rules + Senso KB."""
    from core.decision_log import save_feedback_update

    msg_lower = message.lower()

    rules_path = Path(__file__).resolve().parent.parent / "data" / "risk_rules.md"

    # Determine what kind of feedback this is
    summary_parts: list[str] = []

    if "conservative" in msg_lower:
        summary_parts.append("switched to conservative mode (thresholds raised by 0.1)")
    elif "aggressive" in msg_lower:
        summary_parts.append("switched to aggressive mode (thresholds lowered by 0.1)")

    if "volatile" in msg_lower or "volatility" in msg_lower:
        summary_parts.append("volatile-days mode activated (strict rules applied to all tickers)")

    if not summary_parts:
        summary_parts.append(f"strategy updated based on feedback: {message[:80]}")

    summary = "; ".join(summary_parts)

    # Append feedback note to risk rules and re-ingest
    if rules_path.exists():
        existing = rules_path.read_text()
        feedback_entry = f"\n## Trader Feedback (latest)\n- \"{message}\"\n- Applied: {summary}\n"

        # Replace previous feedback section if it exists
        if "## Trader Feedback (latest)" in existing:
            idx = existing.index("## Trader Feedback (latest)")
            updated = existing[:idx] + feedback_entry
        else:
            updated = existing + "\n" + feedback_entry

        rules_path.write_text(updated)

        # Re-ingest into Senso KB
        try:
            from core.senso_client import reingest_risk_rules

            await reingest_risk_rules(updated)
        except Exception:
            logger.exception("Failed to re-ingest risk rules after feedback")

    # Save to optimizer state
    await save_feedback_update(summary)

    logger.info("Feedback applied: %s", summary)
    return summary
