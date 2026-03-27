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
    """Pure-Python rule evaluation when no LLM is available."""
    ticker = input.get("ticker", "")
    confidence = float(input.get("confidence", 0.0))
    opp_type = input.get("type", "")

    # Ticker-specific adjustments
    threshold_block = 0.5
    threshold_allow = 0.7
    if ticker == "TSLA":
        threshold_block = 0.6
        threshold_allow = 0.8
    elif ticker in ("AAPL", "QQQ"):
        threshold_block = 0.45
        threshold_allow = 0.65

    # Slippage-window specific
    if opp_type == "slippage_window":
        threshold_allow = max(threshold_allow, 0.75)

    if confidence < threshold_block:
        return {
            "verdict": "block",
            "reason": f"Confidence {confidence} below block threshold {threshold_block} for {ticker}",
            "confidence": confidence,
        }
    elif confidence >= threshold_allow:
        return {
            "verdict": "allow",
            "reason": f"Confidence {confidence} meets allow threshold {threshold_allow} for {ticker}",
            "confidence": confidence,
        }
    else:
        return {
            "verdict": "block",
            "reason": f"Confidence {confidence} in uncertain zone ({threshold_block}-{threshold_allow}) for {ticker}, blocking by default",
            "confidence": confidence,
        }


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
