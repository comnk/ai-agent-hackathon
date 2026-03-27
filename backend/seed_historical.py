"""
Seed historical_prices with 90 days of OHLCV data for all watched tickers.
Benchmarks (SPY, DJI) are fetched alongside each ticker for benchmark_close
and benchmark_delta columns.

Usage:
    python backend/seed_historical.py
"""

import yfinance as yf
import pandas as pd
from datetime import date, timedelta
from ghost import insert_historical_price

WATCHED_TICKERS = ["AAPL", "TSLA", "NVDA", "QQQ"]
BENCHMARK = "SPY"  # primary benchmark stored per row
TRADING_DAYS = 100 # pessimistic estimate to ensure at least 90 trading days are covered after filtering for benchmark matches
# ~1.4x calendar days covers 90 trading days accounting for weekends + holidays
CALENDAR_BUFFER = int(TRADING_DAYS * 1.4)

def fetch_ohlcv(ticker: str, start: date, end: date) -> pd.DataFrame:
    df = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)
    df.index = pd.to_datetime(df.index).date
    return df

def seed():
    end = date.today()
    start = end - timedelta(days=CALENDAR_BUFFER)

    print(f"Fetching benchmark {BENCHMARK} ({start} → {end})...")
    bench_df = fetch_ohlcv(BENCHMARK, start, end)

    for ticker in WATCHED_TICKERS:
        print(f"Fetching {ticker}...")
        ticker_df = fetch_ohlcv(ticker, start, end)

        # Trim to the most recent 90 trading days
        ticker_df = ticker_df.tail(TRADING_DAYS)

        inserted = 0
        skipped = 0

        for trading_date, row in ticker_df.iterrows():
            if trading_date not in bench_df.index:
                skipped += 1
                continue

            bench_close = float(bench_df.loc[trading_date, "Close"])
            close = float(row["Close"])

            record = {
                "ticker":          ticker,
                "date":            trading_date,
                "open":            float(row["Open"]),
                "high":            float(row["High"]),
                "low":             float(row["Low"]),
                "close":           close,
                "volume":          int(row["Volume"]),
                "benchmark":       BENCHMARK,
                "benchmark_close": bench_close,
                "benchmark_delta": round(close - bench_close, 4),
            }

            insert_historical_price(record)
            inserted += 1

        print(f"  {ticker}: {inserted} rows inserted, {skipped} skipped (no benchmark match)")

    print("Done.")

if __name__ == "__main__":
    seed()
