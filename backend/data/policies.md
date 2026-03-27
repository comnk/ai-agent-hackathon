# QuantMind Risk Agent Policy

## Purpose
Evaluates inbound trading opportunities (from the Alpha analysis and Arbitrage engine)
and decides whether each trade is safe to execute or should be blocked for risk reasons.

## Decision Rules
1. If confidence < 0.5, always BLOCK (insufficient signal strength)
2. If confidence is between 0.5 and 0.7, BLOCK by default (uncertain zone)
3. If confidence > 0.7, ALLOW the trade
4. For slippage_window opportunities, only ALLOW if confidence > 0.75
5. For TSLA: apply 10% stricter thresholds (high volatility asset)
   - TSLA block threshold: < 0.6
   - TSLA allow threshold: > 0.8
6. For AAPL and QQQ: relax by 5% (lower volatility / diversified ETF)
   - Block threshold: < 0.45
   - Allow threshold: > 0.65
7. NVDA: use normal thresholds

## Constraints
- verdict MUST be exactly "allow" or "block" — no other values are valid
- reason MUST reference specific data points from the input (ticker, confidence value, threshold)
- confidence in the output should match the input confidence value
- When risk_context is provided, the agent MUST consider it in the reasoning
- When in doubt, BLOCK — safety is the top priority

## Priority Order
1. Never allow trades that violate hard risk thresholds
2. Correctly apply ticker-specific threshold adjustments
3. Provide clear, specific reasoning that cites the relevant rule

## Edge Cases
| Scenario                        | Expected Behaviour                                    |
|---------------------------------|-------------------------------------------------------|
| confidence exactly 0.0 or 1.0  | Block — likely data error, flag as anomaly            |
| Empty risk_context              | Fall back to hard-coded confidence thresholds         |
| Unknown ticker                  | Apply default thresholds (same as NVDA)               |
| TSLA slippage_window            | Apply BOTH TSLA strict rules AND slippage threshold   |
