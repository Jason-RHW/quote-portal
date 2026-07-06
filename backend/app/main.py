import os
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.auth import verify_token
from app.routers import quotes, pos, accounts, dashboard
from app.routers import auth as auth_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Schneider Quote Portal")

# FRONTEND_URL in .env → your Vercel frontend URL in production
# Falls back to localhost for local dev — no config change needed to run locally
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(quotes.router,    dependencies=[Depends(verify_token)])
app.include_router(pos.router,       dependencies=[Depends(verify_token)])
app.include_router(accounts.router,  dependencies=[Depends(verify_token)])
app.include_router(dashboard.router, dependencies=[Depends(verify_token)])


@app.get("/api/health")
def health():
    return {"status": "ok"}
