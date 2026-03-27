"""
QuantMind risk evaluation agent — optimised by Overclaw.

This module defines the `run(input) -> dict` function that Overclaw calls
during optimization.  It is also used by senso.check() at runtime to
evaluate trade opportunities against the risk rules stored in Senso KB.
"""

from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are QuantMind's risk evaluation agent.

You will receive a JSON object describing a trading opportunity along with
relevant risk rules retrieved from the organisation's verified knowledge base.

Your job:
1. Evaluate the opportunity against the risk rules.
2. Decide whether to ALLOW or BLOCK the trade.
3. Return your decision as a JSON object.

Output format (strict JSON, nothing else):
{
  "verdict": "allow" or "block",
  "reason": "one-sentence explanation referencing specific data from the input",
  "confidence": 0.0 to 1.0
}

Rules of thumb:
- When in doubt, BLOCK. Safety first.
- Always cite the specific rule or threshold that drove your decision.
- If risk_context is empty, fall back to the confidence thresholds:
  confidence < 0.5 -> block, confidence > 0.7 -> allow, else block.
"""


def run(input: dict) -> dict:
    """
    Overclaw-compatible entrypoint.

    Parameters
    ----------
    input : dict
        Keys: ticker, type, confidence, detail, risk_context

    Returns
    -------
    dict
        Keys: verdict ("allow"|"block"), reason (str), confidence (float)
    """
    try:
        from overclaw.core.tracer import call_llm  # type: ignore[import-untyped]

        response = call_llm(
            model="claude-sonnet-4-20250514",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(input)},
            ],
        )
    except ImportError:
        # Overclaw not installed — use direct Anthropic SDK
        response = _call_anthropic(input)
    except Exception:
        logger.exception("LLM call failed, falling back to rule-based evaluation")
        return _rule_based_fallback(input)

    return _parse_response(response)


# ---------------------------------------------------------------------------
# Fallbacks
# ---------------------------------------------------------------------------


def _call_anthropic(input: dict) -> str:
    """Direct Anthropic API call when Overclaw tracer is unavailable."""
    try:
        import anthropic  # type: ignore[import-untyped]

        client = anthropic.Anthropic()
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=256,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": json.dumps(input)}],
        )
        return message.content[0].text
    except Exception:
        logger.exception("Anthropic API call failed, using rule-based fallback")
        result = _rule_based_fallback(input)
        return json.dumps(result)


def _rule_based_fallback(input: dict) -> dict:
    """
    Enhanced pure-Python rule evaluation — reads risk_context and detail
    so the Senso KB is used even without an LLM.

    Evaluation order (first match wins):
      1. Data quality checks (zero/perfect confidence, anomaly signals)
      2. Feedback mode override from risk_context (conservative/aggressive/volatile)
      3. Detail-based hard blocks (spread widening, data errors)
      4. Ticker-specific threshold adjustments
      5. Opportunity-type threshold adjustments
      6. Final confidence band decision
    """
    ticker = input.get("ticker", "UNKNOWN")
    confidence = float(input.get("confidence", 0.0))
    opp_type = input.get("type", "")
    detail = (input.get("detail") or "").lower()
    risk_context = (input.get("risk_context") or "").lower()

    # ── 1. Data quality checks ──────────────────────────────────────
    if confidence == 0.0 or confidence == 1.0:
        return {
            "verdict": "block",
            "reason": f"Confidence {confidence} flagged as likely data error (exact 0.0 or 1.0)",
            "confidence": confidence,
        }

    # ── 2. Feedback mode from risk_context ──────────────────────────
    mode_shift = 0.0
    mode_label = "standard"
    if "conservative" in risk_context and "raised" in risk_context:
        mode_shift = 0.1
        mode_label = "conservative"
    elif "aggressive" in risk_context and "lowered" in risk_context:
        mode_shift = -0.1
        mode_label = "aggressive"

    volatile_mode = (
        "volatile" in risk_context and "strict rules applied to all tickers" in risk_context
    )

    # ── 3. Detail-based hard blocks ─────────────────────────────────
    # Spread widening > 3x is an immediate block per risk rules
    spread_block_reason = _check_spread_widening(detail)
    if spread_block_reason:
        return {
            "verdict": "block",
            "reason": spread_block_reason,
            "confidence": confidence,
        }

    # Anomaly signals in detail
    anomaly_reason = _check_anomaly_signals(detail, risk_context)
    if anomaly_reason:
        return {
            "verdict": "block",
            "reason": anomaly_reason,
            "confidence": confidence,
        }

    # ── 4. Ticker-specific thresholds ───────────────────────────────
    threshold_block = 0.5
    threshold_allow = 0.7

    if volatile_mode:
        # Volatile days: apply TSLA-level strict rules to ALL tickers
        threshold_block = 0.6
        threshold_allow = 0.8
    elif ticker == "TSLA":
        threshold_block = 0.6
        threshold_allow = 0.8
    elif ticker in ("AAPL", "QQQ"):
        threshold_block = 0.45
        threshold_allow = 0.65
    # NVDA and unknown tickers: use defaults

    # Apply feedback mode shift
    threshold_block = round(threshold_block + mode_shift, 2)
    threshold_allow = round(threshold_allow + mode_shift, 2)

    # ── 5. Opportunity-type adjustments ─────────────────────────────
    if opp_type == "slippage_window":
        # Slippage window needs higher confidence regardless of ticker
        threshold_allow = max(threshold_allow, round(0.75 + mode_shift, 2))

    elif opp_type == "arbitrage":
        # Positive slippage (spread narrowing) gets slight relaxation if detail confirms
        if "narrowing" in detail or "convergence" in detail:
            threshold_allow = max(threshold_block + 0.05, threshold_allow - 0.05)

    # ── 6. Final confidence band decision ───────────────────────────
    mode_note = f" [{mode_label} mode]" if mode_label != "standard" else ""
    volatile_note = " [volatile-days rules]" if volatile_mode else ""

    if confidence < threshold_block:
        return {
            "verdict": "block",
            "reason": (
                f"Confidence {confidence} below block threshold {threshold_block} "
                f"for {ticker} {opp_type}{mode_note}{volatile_note}"
            ),
            "confidence": confidence,
        }
    elif confidence >= threshold_allow:
        return {
            "verdict": "allow",
            "reason": (
                f"Confidence {confidence} meets allow threshold {threshold_allow} "
                f"for {ticker} {opp_type}{mode_note}{volatile_note}"
            ),
            "confidence": confidence,
        }
    else:
        return {
            "verdict": "block",
            "reason": (
                f"Confidence {confidence} in uncertain zone "
                f"({threshold_block}–{threshold_allow}) for {ticker} — blocking by default"
                f"{mode_note}{volatile_note}"
            ),
            "confidence": confidence,
        }


def _check_spread_widening(detail: str) -> str | None:
    """
    Detect bid-ask spread widening > 3x from the detail string.
    Returns a block reason string if triggered, None otherwise.
    """
    # Match patterns like "3.2x", "4x", "3x faster" in the context of widening
    if "widen" not in detail and "spread" not in detail:
        return None

    multiplier_match = re.search(r"(\d+(?:\.\d+)?)\s*x", detail)
    if multiplier_match:
        multiplier = float(multiplier_match.group(1))
        if multiplier > 3.0:
            return (
                f"Spread widening {multiplier}x detected — exceeds 3x threshold, blocking"
            )

    # Explicit widening mentioned without a multiplier
    if "widen" in detail:
        return "Bid-ask spread widening detected — blocking as precaution"

    return None


def _check_anomaly_signals(detail: str, risk_context: str) -> str | None:
    """
    Detect anomaly patterns in the detail or risk context.
    Returns a block reason string if triggered, None otherwise.
    """
    anomaly_keywords = [
        "data error",
        "data lag",
        "anomaly",
        "stale",
        "corrupted",
        "missing",
        "null",
        "invalid",
    ]
    for kw in anomaly_keywords:
        if kw in detail:
            return f"Anomaly signal in detail: '{kw}' — blocking as precaution"

    if "anomaly" in risk_context and "flag" in risk_context:
        return "Risk context flags an active anomaly condition — blocking as precaution"

    return None


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


def _parse_response(raw: str) -> dict:
    """Extract JSON from an LLM response string."""
    if isinstance(raw, dict):
        return raw

    # Try direct JSON parse
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        pass

    # Try extracting JSON from markdown code block
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding any JSON object in the text
    match = re.search(r"\{[^{}]*\}", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    # Last resort
    logger.warning("Could not parse LLM response, returning block: %s", raw[:200])
    return {
        "verdict": "block",
        "reason": "Failed to parse LLM response — blocking as safety measure",
        "confidence": 0.0,
    }
