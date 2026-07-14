# Schneider Direct — Quote Portal

Internal sales tool for the Schneider Direct marketing team. Tracks quotes,
purchase orders, and account registrations with a shared-password gate.

## What's in this build

- Enterprise UI (navy sidebar, filterable table, brand chips with hover tooltip)
- Login screen with Schneider Direct logo
- Shared-password JWT auth (24-hour sessions)
- Multi-brand line items per quote (brand, SKU, cases)
- Supabase PostgreSQL backend (falls back to local SQLite without DATABASE_URL)

---

## Setup

### 1. Supabase (one-time, ~5 minutes)

1. Create a free project at **supabase.com**
2. Go to **Settings → Database → Connection String → URI**
3. Copy the URI — it looks like:
   `postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres`
4. The app creates its own tables on first startup — no manual SQL needed.

### 2. Backend environment

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
- Paste your Supabase URI into `DATABASE_URL`
- Generate a password hash: `python scripts/hash_password.py yourteampassword`
  Paste the output into `APP_PASSWORD_HASH`
- Generate a secret key: `python -c "import secrets; print(secrets.token_hex(32))"`
  Paste into `SECRET_KEY`

### 3. Run the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 4. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** — you'll see the login screen.

### 5. Import existing data (optional)

To load the original 25 quotes from Excel:
```bash
cd backend
python seed_from_excel.py /path/to/Quote_Data_MKT.xlsx
```

---

## Dev mode (no Supabase)

Skip the DATABASE_URL — the app defaults to a local `quote_portal.db` SQLite file.
Set `APP_PASSWORD=demo1234` in `.env` (or just leave the default).

---

## Architecture

```
frontend/src/
  context/AuthContext.jsx   — JWT storage, 24hr expiry
  pages/LoginPage.jsx       — shared password screen
  api/client.js             — attaches Bearer token, handles 401
  features/quotes/          — main quotes CRUD + line items modal
  features/pos/             — purchase orders
  features/accounts/        — account registrations
  components/BrandChips.jsx — single chip or "+N more" hover popover

backend/app/
  auth.py                   — bcrypt verify + JWT issue/validate
  routers/auth.py           — POST /api/auth/token (public)
  routers/quotes|pos|...    — all protected via Depends(verify_token)
  services/                 — business logic layer
  models/db_models.py       — SQLAlchemy (SQLite or PostgreSQL)
  database.py               — reads DATABASE_URL from .env
```

Data migration: swap `DATABASE_URL` in `.env` from SQLite to Supabase.
Nothing else changes.
