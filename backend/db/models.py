from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class DecisionLog(Base):
    """Every senso.check() call and overmind.record() outcome gets logged here."""

    __tablename__ = "decision_log"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # From the opportunity (senso.check input)
    ticker = Column(String, nullable=False)
    opportunity_type = Column(String, nullable=False)  # e.g. "slippage_window"
    confidence = Column(Float, nullable=False)
    detail = Column(Text, nullable=True)

    # Senso verdict
    action = Column(String, nullable=False)  # "allowed" or "blocked"
    reason = Column(Text, nullable=True)

    # Outcome (populated later by overmind.record)
    decision_id = Column(String, nullable=True)  # e.g. "dec_001"
    profitable = Column(Boolean, nullable=True)
    delta = Column(Float, nullable=True)
    cycle = Column(Integer, nullable=True)

    created_at = Column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )


class StrategyHistory(Base):
    """Tracks Overmind optimizer metrics over time."""

    __tablename__ = "strategy_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cycle = Column(Integer, nullable=False)
    alpha_accuracy = Column(Float, nullable=True)
    arbitrage_hit_rate = Column(Float, nullable=True)
    risk_score = Column(Float, nullable=True)
    update_summary = Column(Text, nullable=True)
    created_at = Column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )


class OptimizerState(Base):
    """Singleton row tracking current optimizer state."""

    __tablename__ = "optimizer_state"

    id = Column(Integer, primary_key=True, default=1)
    cycle_count = Column(Integer, nullable=False, default=0)
    last_optimized_at = Column(DateTime, nullable=True)
    recent_updates = Column(Text, nullable=True)  # JSON list of strings
