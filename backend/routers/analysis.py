"""FastAPI router exposing alpha scores, arbitrage signals, decisions, and agent status."""
from typing import Any

from fastapi import APIRouter, Query

from backend.agent.decision import latest_decisions, latest_alpha, latest_arbitrage, agent_status
from backend.ghost import get_historical_prices, get_live_quotes

TICKERS = ["AAPL", "TSLA", "NVDA", "QQQ"]

router = APIRouter()


@router.get("/alpha", response_model=list[dict])
async def get_alpha() -> list[dict[str, Any]]:
    """Return latest alpha scores cached by the agent loop."""
    return latest_alpha


@router.get("/arbitrage", response_model=list[dict])
async def get_arbitrage() -> list[dict[str, Any]]:
    """Return latest arbitrage opportunities cached by the agent loop."""
    return latest_arbitrage


@router.get("/decisions", response_model=list[dict])
async def get_decisions() -> list[dict[str, Any]]:
    """Return the latest ranked decision list from the agent loop."""
    return latest_decisions


@router.get("/agent/status", response_model=dict)
async def get_agent_status() -> dict[str, Any]:
    """Return current agent runtime status."""
    return agent_status


@router.get("/data/prices")
async def get_prices(
    ticker: str = Query(None, description="Single ticker, e.g. AAPL. Omit for all watched tickers."),
    days: int = Query(90, description="Number of days of history to return."),
) -> list[dict[str, Any]]:
    """Return raw historical prices from Vincent's DB for one or all tickers."""
    tickers = [ticker] if ticker else TICKERS
    rows: list[dict[str, Any]] = []
    for t in tickers:
        df = get_historical_prices(t, days=days)
        if not df.empty:
            rows.extend(df.to_dict(orient="records"))
    return rows


@router.get("/data/quotes")
async def get_quotes(
    ticker: str = Query(None, description="Single ticker, e.g. AAPL. Omit for all watched tickers."),
) -> list[dict[str, Any]]:
    """Return latest live quotes from Vincent's DB for one or all tickers."""
    tickers = [ticker] if ticker else TICKERS
    rows: list[dict[str, Any]] = []
    for t in tickers:
        df = get_live_quotes(t)
        if not df.empty:
            rows.extend(df.to_dict(orient="records"))
    return rows
