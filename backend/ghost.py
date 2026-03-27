"""
Ghost Python client for QuantMind Financial Database.
Exposes read/write helpers for historical_prices and live_quotes.
"""

import psycopg2
import psycopg2.extras
import pandas as pd

GHOST_CONN_STR = (
    "postgresql://tsdbadmin:dv8booyosevrcq1o"
    "@gkli3ayfsr.fyphezo20t.tsdb.cloud.timescale.com:34961/tsdb"
)

# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def get_historical_prices(ticker: str, days: int = 90) -> pd.DataFrame:
    """
    Returns a DataFrame of historical OHLCV rows for *ticker* covering the
    last *days* calendar days.

    Columns: ticker, date, open, high, low, close, volume,
             benchmark, benchmark_close, benchmark_delta

    Returns an empty DataFrame if the ticker is not found.
    """
    sql = """
        SELECT
            ticker, date, open, high, low, close, volume,
            benchmark, benchmark_close, benchmark_delta
        FROM historical_prices
        WHERE ticker = %s
          AND date >= CURRENT_DATE - (%s * INTERVAL '1 day')
        ORDER BY date ASC
    """
    try:
        with psycopg2.connect(GHOST_CONN_STR) as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, (ticker, days))
                rows = cur.fetchall()
    except Exception as exc:
        raise RuntimeError(
            f"get_historical_prices failed for ticker={ticker!r}: {exc}"
        ) from exc

    if not rows:
        return pd.DataFrame(
            columns=[
                "ticker", "date", "open", "high", "low", "close", "volume",
                "benchmark", "benchmark_close", "benchmark_delta",
            ]
        )
    return pd.DataFrame(rows)


def get_live_quotes(ticker: str, limit: int = 50) -> pd.DataFrame:
    """
    Returns the latest *limit* live-quote rows for *ticker*, ordered by
    timestamp DESC.

    Columns: ticker, timestamp, price, bid, ask, spread, volume_delta

    Returns an empty DataFrame if the ticker is not found.
    """
    sql = """
        SELECT ticker, timestamp, price, bid, ask, spread, volume_delta
        FROM live_quotes
        WHERE ticker = %s
        ORDER BY timestamp DESC
        LIMIT %s
    """
    try:
        with psycopg2.connect(GHOST_CONN_STR) as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, (ticker, limit))
                rows = cur.fetchall()
    except Exception as exc:
        raise RuntimeError(
            f"get_live_quotes failed for ticker={ticker!r}: {exc}"
        ) from exc

    if not rows:
        return pd.DataFrame(
            columns=["ticker", "timestamp", "price", "bid", "ask", "spread", "volume_delta"]
        )
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------

def insert_historical_price(row: dict) -> None:
    """
    Insert a single row into historical_prices.
    Silently ignores duplicate (ticker, date) pairs (ON CONFLICT DO NOTHING).

    Expected keys: ticker, date, open, high, low, close, volume,
                   benchmark, benchmark_close, benchmark_delta
    """
    sql = """
        INSERT INTO historical_prices
            (ticker, date, open, high, low, close, volume,
             benchmark, benchmark_close, benchmark_delta)
        VALUES
            (%(ticker)s, %(date)s, %(open)s, %(high)s, %(low)s, %(close)s,
             %(volume)s, %(benchmark)s, %(benchmark_close)s, %(benchmark_delta)s)
        ON CONFLICT (ticker, date) DO NOTHING
    """
    try:
        with psycopg2.connect(GHOST_CONN_STR) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, row)
            conn.commit()
    except Exception as exc:
        raise RuntimeError(
            f"insert_historical_price failed for row={row!r}: {exc}"
        ) from exc


def upsert_live_quote(row: dict) -> None:
    """
    Upsert a single row into live_quotes.
    On conflict for (ticker, timestamp), updates price, bid, ask, volume_delta.
    Do NOT include 'spread' — it is a generated column (ask - bid).

    Expected keys: ticker, timestamp, price, bid, ask, volume_delta
    """
    sql = """
        INSERT INTO live_quotes
            (ticker, timestamp, price, bid, ask, volume_delta)
        VALUES
            (%(ticker)s, %(timestamp)s, %(price)s, %(bid)s, %(ask)s, %(volume_delta)s)
        ON CONFLICT (ticker, timestamp) DO UPDATE SET
            price        = EXCLUDED.price,
            bid          = EXCLUDED.bid,
            ask          = EXCLUDED.ask,
            volume_delta = EXCLUDED.volume_delta
    """
    try:
        with psycopg2.connect(GHOST_CONN_STR) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, row)
            conn.commit()
    except Exception as exc:
        raise RuntimeError(
            f"upsert_live_quote failed for row={row!r}: {exc}"
        ) from exc

# debug
def run_query(query):
    try:
        with psycopg2.connect(GHOST_CONN_STR) as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(query)
                rows = cur.fetchall()
    except Exception as exc:
        raise RuntimeError(
            f"run_query failed for query={query!r}: {exc}"
        ) from exc
    return pd.DataFrame(rows)