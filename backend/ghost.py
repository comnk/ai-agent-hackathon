"""Stub for Vincent's data layer — replace with real implementation."""
import random
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

TICKERS = ["AAPL", "TSLA", "NVDA", "QQQ"]
BENCHMARKS = {"SPY": 450.0, "DJI": 380.0}

# Seed prices so mocks are internally consistent
_BASE_PRICES: dict[str, float] = {
    "AAPL": 185.0, "TSLA": 245.0, "NVDA": 480.0, "QQQ": 420.0
}


def get_historical_prices(ticker: str, days: int = 90) -> pd.DataFrame:
    """Return synthetic OHLCV + benchmark data for the requested ticker."""
    rng = np.random.default_rng(seed=abs(hash(ticker)) % (2**32))
    base = _BASE_PRICES.get(ticker, 200.0)
    bmark_base = 450.0  # SPY proxy

    dates = [datetime.now(timezone.utc).date() - timedelta(days=i) for i in range(days - 1, -1, -1)]
    # Simulate cumulative log-returns
    log_returns = rng.normal(0.0005, 0.015, size=days)
    bmark_log_returns = rng.normal(0.0003, 0.010, size=days)

    closes = base * np.exp(np.cumsum(log_returns))
    bmark_closes = bmark_base * np.exp(np.cumsum(bmark_log_returns))

    opens = closes * rng.uniform(0.99, 1.01, size=days)
    highs = np.maximum(closes, opens) * rng.uniform(1.00, 1.015, size=days)
    lows = np.minimum(closes, opens) * rng.uniform(0.985, 1.00, size=days)
    volumes = rng.integers(5_000_000, 50_000_000, size=days)

    bmark_delta = np.diff(bmark_closes, prepend=bmark_closes[0]) / np.where(
        bmark_closes == 0, 1, bmark_closes
    )

    return pd.DataFrame({
        "ticker": ticker,
        "date": dates,
        "open": np.round(opens, 2),
        "high": np.round(highs, 2),
        "low": np.round(lows, 2),
        "close": np.round(closes, 2),
        "volume": volumes,
        "benchmark": "SPY",
        "benchmark_close": np.round(bmark_closes, 2),
        "benchmark_delta": np.round(bmark_delta, 6),
    })


def get_live_quotes(ticker: str) -> pd.DataFrame:
    """Return synthetic live tick data (last 40 ticks) for the requested ticker."""
    rng = np.random.default_rng(seed=abs(hash(ticker + "live")) % (2**32))
    base = _BASE_PRICES.get(ticker, 200.0)
    now = datetime.now(timezone.utc)

    n = 40
    timestamps = [now - timedelta(seconds=(n - i) * 0.5) for i in range(n)]
    prices = base + rng.normal(0, 0.10, size=n).cumsum()
    prices = np.round(np.abs(prices), 2)

    spreads = np.round(rng.uniform(0.01, 0.05, size=n), 4)
    bids = np.round(prices - spreads / 2, 2)
    asks = np.round(prices + spreads / 2, 2)

    # Occasional volume spike on the last few ticks for realism
    vol_delta = rng.integers(100, 5000, size=n).astype(float)
    vol_delta[-3:] *= rng.choice([1, 4], size=3)  # random spikes

    return pd.DataFrame({
        "ticker": ticker,
        "timestamp": [t.isoformat() for t in timestamps],
        "price": prices,
        "bid": bids,
        "ask": asks,
        "spread": spreads,
        "volume_delta": vol_delta,
    })
