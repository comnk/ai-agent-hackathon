"""Alpha, Sharpe, and momentum calculations for watched tickers."""
from typing import Any

import numpy as np
import pandas as pd

from backend.ghost import get_historical_prices

TICKERS = ["AAPL", "TSLA", "NVDA", "QQQ"]
RISK_FREE_RATE = 0.05
TRADING_DAYS = 252


def _annualized_return(series: pd.Series) -> float:
    """Convert a daily-close series to an annualized return."""
    if len(series) < 2:
        return 0.0
    total = series.iloc[-1] / series.iloc[0] - 1
    n_days = len(series)
    return (1 + total) ** (TRADING_DAYS / n_days) - 1


def _rolling_alpha(prices: pd.DataFrame, window: int) -> float:
    """Compute annualized alpha for a ticker vs its benchmark over `window` days."""
    df = prices.tail(window)
    ticker_ret = _annualized_return(df["close"])
    bench_ret = _annualized_return(df["benchmark_close"])
    return round(ticker_ret - bench_ret, 6)


def _sharpe(prices: pd.DataFrame) -> float:
    """Compute Sharpe ratio using all available close prices."""
    daily = prices["close"].pct_change().dropna()
    if daily.std() == 0:
        return 0.0
    excess = daily.mean() * TRADING_DAYS - RISK_FREE_RATE
    vol = daily.std() * np.sqrt(TRADING_DAYS)
    return round(excess / vol, 4)


def _momentum_14d(prices: pd.DataFrame) -> float:
    """Rate-of-change momentum over the last 14 trading days."""
    if len(prices) < 15:
        return 0.0
    close_today = prices["close"].iloc[-1]
    close_14d = prices["close"].iloc[-15]
    if close_14d == 0:
        return 0.0
    return round((close_today - close_14d) / close_14d, 6)


def compute_alpha_scores() -> list[dict[str, Any]]:
    """Fetch historical data and return alpha/Sharpe/momentum scores for all tickers."""
    results: list[dict[str, Any]] = []

    for ticker in TICKERS:
        prices = get_historical_prices(ticker, days=90)

        results.append({
            "ticker": ticker,
            "alpha_30d": _rolling_alpha(prices, 30),
            "alpha_90d": _rolling_alpha(prices, 90),
            "sharpe": _sharpe(prices),
            "momentum_14d": _momentum_14d(prices),
        })

    # Sort by alpha_30d descending
    results.sort(key=lambda x: x["alpha_30d"], reverse=True)
    return results
