"""Arbitrage opportunity detection: slippage window, price divergence, HFT window."""
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from backend.ghost import get_live_quotes

TICKERS = ["AAPL", "TSLA", "NVDA", "QQQ"]
PAIRS = [("AAPL", "QQQ"), ("TSLA", "NVDA")]
ROLLING_WINDOW = 20  # ticks for rolling stats


def _detect_slippage_window(ticker: str, quotes: pd.DataFrame) -> dict[str, Any] | None:
    """Detect when spread is narrowing faster than 1.5× its 20-tick rolling average."""
    if len(quotes) < ROLLING_WINDOW + 1:
        return None

    rolling_avg = quotes["spread"].rolling(ROLLING_WINDOW).mean()
    current_spread = quotes["spread"].iloc[-1]
    avg_spread = rolling_avg.iloc[-1]

    if avg_spread == 0:
        return None

    # Narrowing: current spread is well below the rolling average
    ratio = current_spread / avg_spread
    if ratio < (1 / 1.5):  # spread < 66 % of avg → narrowing > 1.5×
        confidence = round(min(1.0, (1 - ratio) * 2), 4)
        return {
            "ticker": ticker,
            "type": "slippage_window",
            "confidence": confidence,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "detail": (
                f"Spread {current_spread:.4f} is {ratio:.2f}× rolling avg {avg_spread:.4f} "
                f"(threshold <0.67×)"
            ),
        }
    return None


def _detect_price_divergence(
    t1: str, q1: pd.DataFrame, t2: str, q2: pd.DataFrame
) -> dict[str, Any] | None:
    """Detect z-score divergence > 2.0 between a correlated pair."""
    n = min(len(q1), len(q2))
    if n < 10:
        return None

    spread = q1["price"].iloc[-n:].values - q2["price"].iloc[-n:].values
    mean, std = spread.mean(), spread.std()
    if std == 0:
        return None

    z = (spread[-1] - mean) / std
    if abs(z) > 2.0:
        confidence = round(min(1.0, (abs(z) - 2.0) / 3.0 + 0.5), 4)
        direction = "above" if z > 0 else "below"
        return {
            "ticker": f"{t1}/{t2}",
            "type": "price_divergence",
            "confidence": confidence,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "detail": (
                f"{t1} is {direction} {t2} by z={z:.2f} (threshold ±2.0); "
                f"spread mean={mean:.2f}, std={std:.2f}"
            ),
        }
    return None


def _detect_hft_window(ticker: str, quotes: pd.DataFrame) -> dict[str, Any] | None:
    """Detect volume_delta spike >2 std devs AND spread compression >10 %."""
    if len(quotes) < ROLLING_WINDOW:
        return None

    vol = quotes["volume_delta"]
    vol_mean, vol_std = vol.mean(), vol.std()
    current_vol = vol.iloc[-1]

    spread = quotes["spread"]
    spread_baseline = spread.iloc[: ROLLING_WINDOW].mean()
    current_spread = spread.iloc[-1]

    if vol_std == 0 or spread_baseline == 0:
        return None

    vol_z = (current_vol - vol_mean) / vol_std
    spread_compression = (spread_baseline - current_spread) / spread_baseline

    if vol_z > 2.0 and spread_compression > 0.10:
        confidence = round(min(1.0, (vol_z / 4.0) * 0.5 + spread_compression * 0.5), 4)
        return {
            "ticker": ticker,
            "type": "hft_window",
            "confidence": confidence,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "detail": (
                f"Volume spike z={vol_z:.2f} (>2.0) and spread compressed "
                f"{spread_compression*100:.1f}% (>10%) — HFT window detected"
            ),
        }
    return None


def _cast_floats(df: pd.DataFrame) -> pd.DataFrame:
    """Cast all numeric columns to float to avoid Decimal arithmetic errors."""
    for col in ("price", "bid", "ask", "spread", "volume_delta"):
        if col in df.columns:
            df[col] = df[col].astype(float)
    return df


def detect_arbitrage_opportunities() -> list[dict[str, Any]]:
    """Fetch live quotes and return all detected arbitrage opportunities."""
    opportunities: list[dict[str, Any]] = []
    quotes_cache: dict[str, pd.DataFrame] = {
        t: _cast_floats(get_live_quotes(t)) for t in TICKERS
    }

    for ticker, quotes in quotes_cache.items():
        opp = _detect_slippage_window(ticker, quotes)
        if opp:
            opportunities.append(opp)

        opp = _detect_hft_window(ticker, quotes)
        if opp:
            opportunities.append(opp)

    for t1, t2 in PAIRS:
        opp = _detect_price_divergence(t1, quotes_cache[t1], t2, quotes_cache[t2])
        if opp:
            opportunities.append(opp)

    return opportunities
