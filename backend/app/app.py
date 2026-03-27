from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import market_routes

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market_routes.router)


@app.get("/")
async def root():
    return {"message": "Hello World"}