# Analysis Engine

Two modules that power QuantMind's signal generation: `alpha.py` and `arbitrage.py`.

---

## alpha.py

**What it does:** Measures how well each ticker is performing *relative to the market*, and how consistently.

Three metrics are computed per ticker (AAPL, TSLA, NVDA, QQQ):

### 1. Alpha — "Is this stock beating the market?"

> Alpha = annualized return of the ticker − annualized return of SPY

- Positive alpha → the stock outperformed the market
- Negative alpha → underperformed
- Calculated over two windows: last **30 days** (recent trend) and last **90 days** (longer trend)
- Example: `alpha_30d = +0.65` means AAPL returned 65% more than SPY annualized over the last 30 days

### 2. Sharpe Ratio — "Is the return worth the risk?"

> Sharpe = (annualized return − 5% risk-free rate) / annualized volatility

- Higher = better risk-adjusted returns
- A Sharpe above 1.0 is generally considered good
- Uses all 90 days of daily price changes to compute volatility

### 3. Momentum (14d) — "Is the price accelerating?"

> Momentum = (today's close − close 14 days ago) / close 14 days ago

- Simple rate of change over 2 weeks
- Positive = price trending up, negative = trending down

Results are sorted by `alpha_30d` descending — the ticker outperforming the market the most is always first.

**Minimum data required:** 90 rows in `historical_prices` per ticker.

---

## arbitrage.py

**What it does:** Scans live tick data every agent cycle looking for short-lived pricing inefficiencies. Three detectors run in parallel:

### 1. Slippage Window — "Is the spread unusually tight right now?"

The spread is the gap between bid and ask price. Market makers widen it when uncertain and tighten it when confident. A sudden tightening = a window where you can trade with minimal slippage cost.

> Fires when: `current spread < (rolling 20-tick average / 1.5)`

If the average spread over the last 20 ticks was $0.04 and it's now $0.02 — that's a slippage window. Confidence scales with how much tighter it is.

### 2. Price Divergence — "Are two correlated stocks out of sync?"

AAPL/QQQ and TSLA/NVDA normally move together. When they diverge unusually, it signals a mean-reversion opportunity — the gap should close.

> Fires when: z-score of `(price_t1 − price_t2)` exceeds **±2.0** standard deviations from its recent mean

A z-score of 2.0 means the spread is 2 standard deviations wider than normal (statistically rare, ~5% of the time). Confidence increases the further beyond 2.0 it goes.

### 3. HFT Window — "Is a big player moving the market right now?"

High-frequency traders leave a fingerprint: a sudden spike in trade volume *combined with* spread compression. Volume spike = large orders executing; spread compression = temporarily better liquidity.

> Fires when: `volume_delta > mean + 2×std` **AND** `spread is >10% below its baseline`

Both conditions must be true simultaneously — volume alone could be noise, but volume + tight spread = likely institutional activity you can trade alongside.

**Minimum data required:** ~40 ticks in `live_quotes` per ticker.

---

## Output shapes

**Alpha** (`GET /alpha`):
```json
{
  "ticker": "AAPL",
  "alpha_30d": 0.65,
  "alpha_90d": 0.21,
  "sharpe": 1.42,
  "momentum_14d": 0.034
}
```

**Arbitrage** (`GET /arbitrage`):
```json
{
  "ticker": "TSLA",
  "type": "slippage_window",
  "confidence": 0.87,
  "timestamp": "2026-03-27T19:52:17Z",
  "detail": "Spread 0.016 is 0.50× rolling avg 0.033 (threshold <0.67×)"
}
```

`type` is one of: `slippage_window` | `price_divergence` | `hft_window`
