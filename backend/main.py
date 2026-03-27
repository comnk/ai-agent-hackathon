"""QuantMind FastAPI application entry point."""
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers.analysis import router as analysis_router
from backend.agent.decision import start_agent

app = FastAPI(title="QuantMind Analysis Engine", version="0.1.0")

# CORS — allow Victor's Next.js frontend on any local port
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analysis_router)


@app.on_event("startup")
async def startup() -> None:
    """Start the autonomous decision agent loop on server startup."""
    start_agent()


@app.get("/")
async def root() -> dict:
    """Health-check endpoint."""
    return {"status": "ok", "service": "QuantMind Analysis Engine"}
