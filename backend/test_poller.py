import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, call
from hypothesis import given, settings
from hypothesis import strategies as st

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import poller
from poller import fetch_quote, poll_once, WATCHED_TICKERS
import ghost


# ---------------------------------------------------------------------------
# Unit Tests
# ---------------------------------------------------------------------------

# 4.1 — Startup banner is printed before first poll_once call
def test_startup_banner_printed_before_poll_once():
    call_order = []

    def record_print(*args, **kwargs):
        call_order.append(("print", args))

    def record_poll_and_stop():
        call_order.append(("poll_once",))
        # Use SystemExit (not caught by broad `except Exception`) to break the loop
        raise SystemExit(0)

    with patch("poller.poll_once", side_effect=record_poll_and_stop), \
         patch("builtins.print", side_effect=record_print), \
         patch("time.sleep"):
        try:
            poller.run()
        except SystemExit:
            pass

    print_indices = [i for i, entry in enumerate(call_order) if entry[0] == "print"]
    poll_indices = [i for i, entry in enumerate(call_order) if entry[0] == "poll_once"]

    assert print_indices, "print was never called"
    assert poll_indices, "poll_once was never called"

    # At least one print call must contain "QuantMind Poller" and appear before poll_once
    banner_prints = [
        i for i in print_indices
        if any("QuantMind Poller" in str(a) for a in call_order[i][1])
    ]
    assert banner_prints, "No print call contained 'QuantMind Poller'"
    assert banner_prints[0] < poll_indices[0], "Banner was not printed before poll_once"


# 4.2 — poll_once with all-valid quotes calls upsert_live_quote for each ticker
def test_poll_once_all_valid_calls_upsert_for_each_ticker():
    def make_valid_row(ticker):
        return {
            "ticker": ticker,
            "timestamp": datetime.now(tz=timezone.utc),
            "price": 150.0,
            "bid": 149.9,
            "ask": 150.1,
            "volume_delta": 0,
        }

    with patch("poller.fetch_quote", side_effect=make_valid_row), \
         patch("ghost.upsert_live_quote") as mock_upsert:
        poll_once()

    assert mock_upsert.call_count == len(WATCHED_TICKERS)


# 4.3 — poll_once with mixed quotes calls upsert only for valid ones
def test_poll_once_mixed_quotes_calls_upsert_only_for_valid():
    # AAPL → None, TSLA → ask < bid, NVDA → valid, QQQ → valid
    def fetch_side_effect(ticker):
        if ticker == "AAPL":
            return None
        if ticker == "TSLA":
            return {
                "ticker": ticker,
                "timestamp": datetime.now(tz=timezone.utc),
                "price": 200.0,
                "bid": 200.5,
                "ask": 199.5,  # ask < bid — invalid
                "volume_delta": 0,
            }
        return {
            "ticker": ticker,
            "timestamp": datetime.now(tz=timezone.utc),
            "price": 100.0,
            "bid": 99.9,
            "ask": 100.1,
            "volume_delta": 0,
        }

    with patch("poller.fetch_quote", side_effect=fetch_side_effect), \
         patch("ghost.upsert_live_quote") as mock_upsert:
        poll_once()

    assert mock_upsert.call_count == 2


# ---------------------------------------------------------------------------
# Property-Based Tests
# ---------------------------------------------------------------------------

# 4.4 — Property 1: fetch_quote returns None for missing data
# Feature: quantmind-polling, Property 1: fetch_quote returns None for missing data
@given(ticker=st.sampled_from(["AAPL", "TSLA", "NVDA", "QQQ"]))
@settings(max_examples=100)
def test_fetch_quote_returns_none_on_missing_data(ticker):
    # Mock fast_info to raise an exception
    with patch("yfinance.Ticker") as mock_ticker:
        mock_ticker.return_value.fast_info = MagicMock(side_effect=Exception("no data"))
        prev = dict(poller._prev_volume)
        result = poller.fetch_quote(ticker)
        assert result is None
        assert poller._prev_volume == prev  # _prev_volume unchanged


# 4.5 — Property 2: fetch_quote result structure and UTC timestamp
# Feature: quantmind-polling, Property 2: fetch_quote result structure and UTC timestamp
@given(
    ticker=st.sampled_from(["AAPL", "TSLA", "NVDA", "QQQ"]),
    price=st.floats(min_value=1.0, max_value=10000.0, allow_nan=False),
    bid=st.floats(min_value=0.01, max_value=9999.0, allow_nan=False),
    ask=st.floats(min_value=0.01, max_value=10000.0, allow_nan=False),
    volume=st.integers(min_value=0, max_value=10_000_000),
)
@settings(max_examples=100)
def test_fetch_quote_structure_and_utc_timestamp(ticker, price, bid, ask, volume):
    mock_fast_info = MagicMock()
    mock_fast_info.last_price = price
    mock_fast_info.bid = bid
    mock_fast_info.ask = ask
    mock_fast_info.three_month_average_volume = volume
    with patch("yfinance.Ticker") as mock_ticker:
        mock_ticker.return_value.fast_info = mock_fast_info
        poller._prev_volume.clear()
        result = poller.fetch_quote(ticker)
    assert result is not None
    assert set(result.keys()) == {"ticker", "timestamp", "price", "bid", "ask", "volume_delta"}
    assert result["timestamp"].tzinfo is not None
    assert result["timestamp"].tzinfo.utcoffset(result["timestamp"]).total_seconds() == 0


# 4.6 — Property 3: volume delta correctness
# Feature: quantmind-polling, Property 3: volume delta correctness
@given(
    ticker=st.sampled_from(["AAPL", "TSLA", "NVDA", "QQQ"]),
    v1=st.integers(min_value=0, max_value=10_000_000),
    v2=st.integers(min_value=0, max_value=10_000_000),
)
@settings(max_examples=100)
def test_volume_delta_correctness(ticker, v1, v2):
    def make_fast_info(volume):
        fi = MagicMock()
        fi.last_price = 100.0
        fi.bid = 99.0
        fi.ask = 101.0
        fi.three_month_average_volume = volume
        return fi

    poller._prev_volume.pop(ticker, None)

    with patch("yfinance.Ticker") as mock_ticker:
        mock_ticker.return_value.fast_info = make_fast_info(v1)
        result1 = poller.fetch_quote(ticker)
    assert result1["volume_delta"] == 0  # first tick always 0

    with patch("yfinance.Ticker") as mock_ticker:
        mock_ticker.return_value.fast_info = make_fast_info(v2)
        result2 = poller.fetch_quote(ticker)
    assert result2["volume_delta"] == v2 - v1


# 4.7 — Property 4: only valid quotes are upserted
# Feature: quantmind-polling, Property 4: only valid quotes are upserted
@given(
    quote_specs=st.lists(
        st.one_of(
            st.just(None),
            st.fixed_dictionaries({
                "valid": st.booleans(),
                "ask_lt_bid": st.booleans(),
            })
        ),
        min_size=4, max_size=4
    )
)
@settings(max_examples=100)
def test_only_valid_quotes_upserted(quote_specs):
    # Build fetch_quote side effects
    def make_row(spec, ticker):
        if spec is None:
            return None
        bid = 100.0
        ask = 99.0 if spec["ask_lt_bid"] else 101.0
        return {"ticker": ticker, "timestamp": datetime.now(tz=timezone.utc),
                "price": 100.0, "bid": bid, "ask": ask, "volume_delta": 0}

    side_effects = [make_row(s, t) for s, t in zip(quote_specs, WATCHED_TICKERS)]
    expected_upserts = sum(
        1 for row in side_effects
        if row is not None and row["ask"] >= row["bid"]
    )

    with patch("poller.fetch_quote", side_effect=side_effects), \
         patch("ghost.upsert_live_quote") as mock_upsert:
        poll_once()

    assert mock_upsert.call_count == expected_upserts


# 4.8 — Property 5: per-ticker errors do not stop poll_once
# Feature: quantmind-polling, Property 5: per-ticker errors do not stop poll_once
@given(failing_index=st.integers(min_value=0, max_value=3))
@settings(max_examples=100)
def test_per_ticker_error_does_not_stop_poll_once(failing_index):
    valid_row = lambda t: {"ticker": t, "timestamp": datetime.now(tz=timezone.utc),
                           "price": 100.0, "bid": 99.0, "ask": 101.0, "volume_delta": 0}

    def upsert_side_effect(row):
        if row["ticker"] == WATCHED_TICKERS[failing_index]:
            raise RuntimeError("DB error")

    with patch("poller.fetch_quote", side_effect=[valid_row(t) for t in WATCHED_TICKERS]), \
         patch("ghost.upsert_live_quote", side_effect=upsert_side_effect) as mock_upsert:
        poll_once()  # should not raise

    assert mock_upsert.call_count == len(WATCHED_TICKERS)


# 4.9 — Property 6: loop continues after poll_once failure
# Feature: quantmind-polling, Property 6: loop continues after poll_once failure
@given(n_failures=st.integers(min_value=1, max_value=5))
@settings(max_examples=20)
def test_loop_continues_after_poll_once_failure(n_failures):
    call_count = {"n": 0}
    max_calls = n_failures + 2

    def poll_side_effect():
        call_count["n"] += 1
        if call_count["n"] <= n_failures:
            raise RuntimeError("simulated failure")
        if call_count["n"] >= max_calls:
            # Use SystemExit (BaseException, not caught by `except Exception`) to break the loop
            raise SystemExit(0)

    with patch("poller.poll_once", side_effect=poll_side_effect), \
         patch("time.sleep"), \
         patch("builtins.print"):
        try:
            poller.run()
        except SystemExit:
            pass

    assert call_count["n"] == max_calls
