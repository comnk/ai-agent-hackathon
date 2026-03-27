"""Stub for Vibhu's Overmind learning recorder — replace with real implementation."""
import json
from datetime import datetime, timezone


def record(decision: dict, outcome: dict) -> None:
    """Persist a decision + outcome pair for reinforcement learning."""
    # Stub: just print to stdout; real impl would write to a store
    entry = {"decision": decision, "outcome": outcome, "recorded_at": datetime.now(timezone.utc).isoformat()}
    print(f"[overmind] {json.dumps(entry)}")
