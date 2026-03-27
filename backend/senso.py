"""Stub for Vibhu's Senso risk-gate — replace with real implementation."""
import random


def check(opportunity: dict) -> bool:
    """Return True if the opportunity passes risk checks, False otherwise."""
    # Stub: approve ~80 % of opportunities; block low-confidence ones
    confidence = opportunity.get("confidence", opportunity.get("score", 0.5))
    if confidence < 0.3:
        return False
    return random.random() > 0.20
