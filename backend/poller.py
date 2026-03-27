"""
QuantMind Polling System
Polls yfinance every POLL_INTERVAL_SECONDS for live market quotes and
upserts each quote into the Ghost (TimescaleDB) live_quotes table.

Entry point: python backend/poller.py
"""

import logging
import time
from datetime import datetime, timezone

import yfinance

import ghost

# ---------------------------------------------------------------------------
# Module-level constants and state
# ---------------------------------------------------------------------------

WATCHED_TICKERS: list[str] = ["AAPL", "TSLA", "NVDA", "QQQ"]
POLL_INTERVAL_SECONDS: int = 5
_prev_volume: dict[str, int] = {}  # module-level state for volume delta

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# fetch_quote
# ---------------------------------------------------------------------------

def fetch_quote(ticker: str) -> dict | None:
    """
    Fetch a single live quote from yfinance for the given ticker.

    Returns a dict with keys: ticker, timestamp, price, bid, ask, volume_delta.
    Returns None if yfinance returns no data or raises any exception.
    _prev_volume is NOT updated when returning None.
    """
    try:
        t = yfinance.Ticker(ticker)
        fast_info = t.fast_info
        info = t.info  # full dict — needed for bid/ask

        price = fast_info.last_price
        bid = info.get("bid") or info.get("regularMarketPrice")
        ask = info.get("ask") or info.get("regularMarketPrice")

        # Treat missing/None core fields as no data
        if price is None or bid is None or ask is None:
            return None

        current_volume = int(fast_info.three_month_average_volume or 0)
        volume_delta = current_volume - _prev_volume.get(ticker, current_volume)
        _prev_volume[ticker] = current_volume

        return {
            "ticker": ticker,
            "timestamp": datetime.now(tz=timezone.utc),
            "price": float(price),
            "bid": float(bid),
            "ask": float(ask),
            "volume_delta": volume_delta,
        }

    except Exception:
        logger.warning("fetch_quote failed for ticker=%r", ticker, exc_info=True)
        return None


# ---------------------------------------------------------------------------
# poll_once
# ---------------------------------------------------------------------------

def poll_once() -> None:
    for ticker in WATCHED_TICKERS:
        row = fetch_quote(ticker)
        if row is None:
            logger.warning("No data for ticker=%r, skipping", ticker)
            continue
        if row["ask"] < row["bid"]:
            logger.warning("Invalid quote for ticker=%r: ask=%s < bid=%s, skipping", ticker, row["ask"], row["bid"])
            continue
        try:
            ghost.upsert_live_quote(row)
            logger.info("Upserted quote for ticker=%r price=%s", ticker, row["price"])
        except Exception:
            logger.error("upsert_live_quote failed for ticker=%r row=%r", ticker, row, exc_info=True)


# ---------------------------------------------------------------------------
# run / __main__  (stub — implemented in Task 3)
# ---------------------------------------------------------------------------

def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(f"QuantMind Poller starting — tickers={WATCHED_TICKERS}, interval={POLL_INTERVAL_SECONDS}s")
    while True:
        try:
            poll_once()
        except Exception:
            logger.error("Unexpected error in poll loop", exc_info=True)
        time.sleep(POLL_INTERVAL_SECONDS)

# for testing purposes.
# in the real thing, the webserver will run the poller
if __name__ == "__main__":
    run()
