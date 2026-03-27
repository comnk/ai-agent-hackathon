# QuantMind Risk Rules

## Confidence Thresholds
- confidence < 0.5 -> BLOCK (insufficient signal)
- confidence 0.5-0.7 -> FLAG for review, treat as BLOCK by default
- confidence > 0.7 -> ALLOW (proceed with trade)

## Spread / Slippage Rules
- slippage_window: only allow if confidence > 0.75
- bid-ask spread widening > 3x 20-tick average -> BLOCK
- positive slippage opportunity must have confidence > 0.8

## Ticker-Specific Rules
- TSLA: apply 10% stricter confidence threshold (high volatility asset)
  - TSLA effective block threshold: confidence < 0.6
  - TSLA effective allow threshold: confidence > 0.8
- NVDA: normal thresholds apply
- AAPL: relax by 5% (lower volatility, blue chip)
  - AAPL effective block threshold: confidence < 0.45
  - AAPL effective allow threshold: confidence > 0.65
- QQQ: relax by 5% (ETF, diversified)
  - QQQ effective block threshold: confidence < 0.45
  - QQQ effective allow threshold: confidence > 0.65

## Anomaly Detection
- Same ticker appearing in opportunities > 3 times in 60 seconds -> FLAG and BLOCK
- Decision confidence showing dropping trend over 5 consecutive cycles -> FLAG
- Any opportunity with confidence exactly 0.0 or 1.0 -> FLAG (likely data error)

## Override Rules (from trader feedback)
- "conservative" mode: raise all confidence thresholds by 0.1
- "aggressive" mode: lower all confidence thresholds by 0.1
- "volatile days" mode: apply TSLA-level strict rules to ALL tickers
- Default mode: use standard thresholds as defined above
