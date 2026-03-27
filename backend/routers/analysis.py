"""FastAPI router exposing alpha scores, arbitrage signals, decisions, and agent status."""
from typing import Any

from fastapi import APIRouter

from backend.analysis.alpha import compute_alpha_scores
from backend.analysis.arbitrage import detect_arbitrage_opportunities
from backend.agent.decision import latest_decisions, agent_status

router = APIRouter()


@router.get("/alpha", response_model=list[dict])
async def get_alpha() -> list[dict[str, Any]]:
    """Return latest alpha scores for all watched tickers, sorted by alpha_30d."""
    return compute_alpha_scores()


@router.get("/arbitrage", response_model=list[dict])
async def get_arbitrage() -> list[dict[str, Any]]:
    """Return currently detected arbitrage opportunities."""
    return detect_arbitrage_opportunities()


@router.get("/decisions", response_model=list[dict])
async def get_decisions() -> list[dict[str, Any]]:
    """Return the latest ranked decision list from the agent loop."""
    return latest_decisions


@router.get("/agent/status", response_model=dict)
async def get_agent_status() -> dict[str, Any]:
    """Return current agent runtime status."""
    return agent_status
