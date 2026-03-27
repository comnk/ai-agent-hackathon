"""
market_router.py  —  FastAPI proxy for Yahoo Finance chart data

Usage:
    from market_router import router
    app.include_router(router)

Endpoints:
    GET /api/market/chart?ticker=AAPL&interval=1d&range=1mo
    GET /api/market/quote?ticker=AAPL
"""

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/market")

YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
}

YAHOO_BASE = "https://query2.finance.yahoo.com/v8/finance/chart"


async def _fetch_yahoo(ticker: str, interval: str, range_: str) -> dict:
    url = f"{YAHOO_BASE}/{ticker}"
    params = {"interval": interval, "range": range_}
    async with httpx.AsyncClient(timeout=10, headers=YAHOO_HEADERS) as client:
        resp = await client.get(url, params=params)
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Yahoo Finance error")
    data = resp.json()
    result = data.get("chart", {}).get("result")
    if not result:
        raise HTTPException(status_code=404, detail="No data returned for this ticker")
    return result[0]


@router.get("/chart")
async def get_chart(
    ticker: str = Query(..., description="Yahoo Finance ticker, e.g. AAPL, BTC-USD, ^GSPC"),
    interval: str = Query("1d", description="e.g. 5m, 60m, 1d, 1wk, 1mo"),
    range: str = Query("1mo", description="e.g. 1d, 5d, 1mo, 3mo, 1y, 5y"),
):
    """Returns timestamp + close price arrays for charting."""
    result = await _fetch_yahoo(ticker, interval, range)
    timestamps = result.get("timestamp", [])
    closes = result["indicators"]["quote"][0].get("close", [])
    points = [
        {"time": t * 1000, "close": c}
        for t, c in zip(timestamps, closes)
        if c is not None
    ]
    return {"ticker": ticker, "points": points}


@router.get("/quote")
async def get_quote(
    ticker: str = Query(..., description="Yahoo Finance ticker"),
):
    """Returns current price, change, changePct, and display name."""
    result = await _fetch_yahoo(ticker, "1m", "1d")
    meta = result.get("meta", {})
    price = meta.get("regularMarketPrice", 0)
    prev = meta.get("chartPreviousClose") or meta.get("previousClose") or price
    change = price - prev
    change_pct = (change / prev * 100) if prev else 0
    return {
        "ticker": ticker,
        "price": price,
        "change": change,
        "changePct": change_pct,
        "name": meta.get("longName") or meta.get("shortName") or ticker,
        "currency": meta.get("currency", "USD"),
    }