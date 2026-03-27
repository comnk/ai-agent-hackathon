"""Interface to the Overclaw CLI for running optimizations."""

from __future__ import annotations

import csv
import logging
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent.parent
OVERCLAW_BASE = BACKEND_DIR / ".overclaw" / "agents" / "quantmind"
EXPERIMENTS_DIR = OVERCLAW_BASE / "experiments"
BEST_AGENT_PATH = EXPERIMENTS_DIR / "best_agent.py"
RESULTS_TSV = EXPERIMENTS_DIR / "results.tsv"
REPORT_MD = EXPERIMENTS_DIR / "report.md"
AGENT_TARGET = BACKEND_DIR / "agents" / "quantmind_agent.py"


def run_optimize() -> bool:
    """Run `overclaw optimize quantmind --fast`. Returns True on success."""
    try:
        result = subprocess.run(
            ["overclaw", "optimize", "quantmind", "--fast"],
            cwd=str(BACKEND_DIR),
            capture_output=True,
            text=True,
            timeout=600,  # 10 min max
        )
        if result.returncode == 0:
            logger.info("Overclaw optimization completed successfully")
            apply_best_agent()
            return True
        else:
            logger.warning("Overclaw optimization failed: %s", result.stderr[:500])
            return False
    except FileNotFoundError:
        logger.warning("overclaw CLI not found — skipping optimization")
        return False
    except subprocess.TimeoutExpired:
        logger.warning("Overclaw optimization timed out after 600s")
        return False
    except Exception:
        logger.exception("Unexpected error running overclaw")
        return False


def run_optimize_async() -> subprocess.Popen | None:
    """Start Overclaw optimization in the background (non-blocking)."""
    try:
        proc = subprocess.Popen(
            ["overclaw", "optimize", "quantmind", "--fast"],
            cwd=str(BACKEND_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        logger.info("Overclaw optimization started (PID %d)", proc.pid)
        return proc
    except FileNotFoundError:
        logger.warning("overclaw CLI not found — skipping background optimization")
        return None
    except Exception:
        logger.exception("Failed to start background overclaw optimization")
        return None


def apply_best_agent() -> bool:
    """Copy best_agent.py from Overclaw experiments into agents/."""
    if not BEST_AGENT_PATH.exists():
        logger.debug("No best_agent.py to apply")
        return False
    try:
        shutil.copy2(BEST_AGENT_PATH, AGENT_TARGET)
        logger.info("Applied best agent from %s", BEST_AGENT_PATH)
        return True
    except Exception:
        logger.exception("Failed to apply best agent")
        return False


def get_score_history() -> list[dict]:
    """Parse results.tsv into a list of {iteration, score} dicts."""
    if not RESULTS_TSV.exists():
        return []
    try:
        with open(RESULTS_TSV) as f:
            reader = csv.DictReader(f, delimiter="\t")
            return [
                {
                    "iteration": int(row.get("iteration", i)),
                    "score": float(row.get("score", 0)),
                }
                for i, row in enumerate(reader)
            ]
    except Exception:
        logger.exception("Failed to parse results.tsv")
        return []


def get_report_updates() -> list[str]:
    """Extract bullet-point updates from report.md."""
    if not REPORT_MD.exists():
        return []
    try:
        updates: list[str] = []
        for line in REPORT_MD.read_text().splitlines():
            stripped = line.strip()
            if stripped.startswith("- ") or stripped.startswith("* "):
                updates.append(stripped.lstrip("-* ").strip())
            if len(updates) >= 10:
                break
        return updates
    except Exception:
        logger.exception("Failed to parse report.md")
        return []
