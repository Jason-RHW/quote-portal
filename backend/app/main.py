import os
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.auth import verify_token
from app.routers import quotes, pos, accounts, dashboard, sdr_performance, cron, samples, spiff
from app.routers import auth as auth_router
from app import startup_migrations

Base.metadata.create_all(bind=engine)
startup_migrations.run(engine)

app = FastAPI(title="Schneider Quote Portal")

# FRONTEND_URL      → the admin app (Quotes/POs/Accounts/Samples), Vite default :5173
# SAMPLE_FORM_URL   → the separate SDR-facing Sample Request form, Vite default :5174
# Both fall back to their local dev ports — no config change needed to run locally.
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
sample_form_url = os.getenv("SAMPLE_FORM_URL", "http://localhost:5174")
cors_origins = {
    frontend_url,
    sample_form_url,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
}
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(cors_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(quotes.router,    dependencies=[Depends(verify_token)])
app.include_router(pos.router,       dependencies=[Depends(verify_token)])
app.include_router(accounts.router,  dependencies=[Depends(verify_token)])
app.include_router(dashboard.router, dependencies=[Depends(verify_token)])
app.include_router(sdr_performance.router, dependencies=[Depends(verify_token)])
app.include_router(spiff.router, dependencies=[Depends(verify_token)])
app.include_router(cron.router)  # own auth (CRON_SECRET) — deliberately not verify_token

# Sample Portal — admin routes share the existing admin JWT (same login as
# Quotes/POs/Accounts, since the admin console is merging into this same app).
app.include_router(samples.router,            dependencies=[Depends(verify_token)])
app.include_router(samples.brands_router,      dependencies=[Depends(verify_token)])
app.include_router(samples.sdrs_router,        dependencies=[Depends(verify_token)])
app.include_router(samples.form_fields_router, dependencies=[Depends(verify_token)])
# Sample Portal — public SDR-form routes, under /api/public (a distinct
# prefix from /api/samples on purpose — see samples.py's public_router
# comment for why). Own auth (SDR access code via Depends(verify_sdr_token)
# inside samples.py), deliberately NOT the admin verify_token — a leaked
# SDR code should never reach admin data.
app.include_router(samples.public_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
