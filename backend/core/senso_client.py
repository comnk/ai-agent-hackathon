"""Thin wrapper around the Senso.ai API (https://apiv2.senso.ai/api/v1)."""

from __future__ import annotations

import hashlib
import logging
import time
from pathlib import Path

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

BASE = "https://apiv2.senso.ai/api/v1"
_RISK_RULES_CONTENT_ID: str | None = None


def _headers() -> dict[str, str]:
    return {
        "X-API-Key": settings.senso_key,
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

async def search_context(query: str, max_results: int = 5) -> list[dict]:
    """POST /org/search/context — returns raw chunks (no AI answer)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{BASE}/org/search/context",
            headers=_headers(),
            json={"query": query, "max_results": max_results},
        )
        resp.raise_for_status()
        return resp.json().get("results", [])


async def full_search(query: str, max_results: int = 5) -> dict:
    """POST /org/search — returns AI answer + source chunks."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{BASE}/org/search",
            headers=_headers(),
            json={"query": query, "max_results": max_results},
        )
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Ingestion — raw text
# ---------------------------------------------------------------------------

async def upload_raw(title: str, text: str) -> str:
    """POST /org/kb/raw — create a raw-text content item. Returns content_id."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{BASE}/org/kb/raw",
            headers=_headers(),
            json={"title": title, "text": text},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("id", data.get("content_id", ""))


# ---------------------------------------------------------------------------
# Ingestion — file upload (presigned-URL flow)
# ---------------------------------------------------------------------------

async def upload_file(file_path: str) -> str:
    """Upload a local file to Senso KB via presigned URL. Returns content_id."""
    path = Path(file_path)
    file_bytes = path.read_bytes()
    md5_hash = hashlib.md5(file_bytes).hexdigest()

    async with httpx.AsyncClient(timeout=60) as client:
        # Step 1 — request presigned URL
        resp = await client.post(
            f"{BASE}/org/kb/upload",
            headers=_headers(),
            json={
                "files": [
                    {
                        "filename": path.name,
                        "file_size_bytes": len(file_bytes),
                        "content_type": "text/markdown",
                        "content_hash_md5": md5_hash,
                    }
                ]
            },
        )
        resp.raise_for_status()
        result = resp.json()["results"][0]
        content_id = result["content_id"]
        upload_url = result["upload_url"]

        # Step 2 — PUT file to S3
        await client.put(upload_url, content=file_bytes)
        logger.info("Uploaded %s -> content_id=%s", path.name, content_id)
        return content_id


async def wait_for_processing(content_id: str, poll_interval: float = 1.0, timeout: float = 60.0) -> bool:
    """Poll GET /org/content/{id} until processing_status == 'complete'."""
    start = time.monotonic()
    async with httpx.AsyncClient(timeout=15) as client:
        while time.monotonic() - start < timeout:
            resp = await client.get(
                f"{BASE}/org/content/{content_id}",
                headers={"X-API-Key": settings.senso_key},
            )
            resp.raise_for_status()
            status = resp.json().get("processing_status")
            logger.debug("content %s status: %s", content_id, status)
            if status == "complete":
                return True
            await _async_sleep(poll_interval)
    logger.warning("Timed out waiting for content %s to process", content_id)
    return False


# ---------------------------------------------------------------------------
# Startup helper
# ---------------------------------------------------------------------------

async def ingest_risk_rules() -> None:
    """Upload data/risk_rules.md to Senso KB on application startup."""
    global _RISK_RULES_CONTENT_ID  # noqa: PLW0603

    if not settings.senso_key:
        logger.warning("SENSO_KEY not set — skipping risk rules ingestion")
        return

    rules_path = Path(__file__).resolve().parent.parent / "data" / "risk_rules.md"
    if not rules_path.exists():
        logger.error("risk_rules.md not found at %s", rules_path)
        return

    try:
        text = rules_path.read_text()
        content_id = await upload_raw("QuantMind Risk Rules", text)
        _RISK_RULES_CONTENT_ID = content_id
        ok = await wait_for_processing(content_id)
        if ok:
            logger.info("Risk rules ingested successfully: %s", content_id)
        else:
            logger.warning("Risk rules ingestion timed out, search may be delayed")
    except Exception:
        logger.exception("Failed to ingest risk rules")


async def reingest_risk_rules(updated_text: str) -> None:
    """Re-upload risk rules after a feedback-driven update."""
    global _RISK_RULES_CONTENT_ID  # noqa: PLW0603

    if not settings.senso_key:
        logger.warning("SENSO_KEY not set — skipping re-ingestion")
        return

    try:
        content_id = await upload_raw("QuantMind Risk Rules (Updated)", updated_text)
        _RISK_RULES_CONTENT_ID = content_id
        await wait_for_processing(content_id)
        logger.info("Risk rules re-ingested: %s", content_id)
    except Exception:
        logger.exception("Failed to re-ingest risk rules")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _async_sleep(seconds: float) -> None:
    import asyncio
    await asyncio.sleep(seconds)
