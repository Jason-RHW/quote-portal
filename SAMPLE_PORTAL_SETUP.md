# Sample Management Portal — Local Setup

Three services, three terminals. Everything defaults to SQLite + localhost
ports, so no `.env` file is required to get running locally.

## 1. Backend (FastAPI + SQLite)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Seeds SDR roster, brands, and Form Builder custom fields into a fresh
# local quote_portal.db (SQLite). Safe to re-run.
python seed_sample_portal.py

uvicorn app.main:app --reload --port 8000
```

Verify: http://localhost:8000/api/health → `{"status":"ok"}`
Interactive API docs: http://localhost:8000/docs

**Default local credentials** (see `app/auth.py` — change before deploying):
- Admin password: `demo1234`
- SDR form access code: `samples1234`

## 2. Admin console (Quotes / POs / Accounts / **Samples** / Dashboard)

```bash
cd frontend
npm install
npm run dev
```

Opens on **http://localhost:5173**. Log in with `demo1234`, click **Samples**
in the sidebar.

## 3. SDR-facing Sample Request Form (separate app, separate URL)

```bash
cd sample-request-form
npm install
npm run dev
```

Opens on **http://localhost:5174** — a genuinely separate Vite project, not
a route inside the admin app (see the build conversation for why). Log in
with `samples1234`.

## Trying the full loop

1. On :5174, submit a sample request (any business name — the rest is
   optional).
2. On :5173 → Samples, the new request appears with a red **Needs
   assignment** brand chip and a red **Unverified** address badge.
3. Click the row to open the drawer. Click **Assign Brands**, check a
   couple, add an optional note, save.
4. Change **Status** to **Sent** — a modal blocks you until you enter a
   tracking number and sent date. Cancel reverts it; filling both in and
   saving actually changes the status.
5. Click **Confirm Verified** under Address Verification to flip it to
   manually-verified (green, with a checkmark).
6. Back on the list, select a few rows with the checkboxes — a bulk action
   bar appears for batch status change / archive.

## What's included vs. deferred

**Built and verified working end-to-end:**
- Full `sample_requests` / `brands` / `sample_request_brands` / `form_fields`
  / `sample_request_events` schema, mirroring the Supabase migration already
  run in production
- SDR-form submission (public, SDR-code-gated) and admin CRUD (shared admin
  JWT), on genuinely separate auth
- Server-side status-change gating (tracking # + sent date required for
  "Sent"; delivered date — plus tracking/sent if skipped — for "Delivered"),
  not just a client-side nicety
- Multi-brand assignment with an assignment note (in both the detail
  drawer's Assign Brands modal AND the manual Add Sample Request drawer)
- Batch status change, batch archive (soft delete, styled confirm modal),
  and batch HubSpot sync (stub-level — flips the sync flags; the real
  HubSpot API call is a drop-in replacement, not built)
- Manual "Add Sample Request" with ungated status/dates for backfill
- Dynamic custom fields (Glove Type, Size, Color, etc.) driven by the
  `form_fields` table, including single- vs. multi-select dropdowns
- Name/email/phone normalization and city/state autocomplete on the SDR form
- Full audit trail via `sample_request_events`
- **Settings page** (Brands tab: add/toggle-active; Form Builder tab: Core
  Fields locked list, Custom Fields with reorder/remove, Add Field panel
  including a "multiple selections" toggle not in the original mockup —
  added because Glove Type/Color genuinely need it, see note below)
- **Date-filter calendar** in Sample Records, disabling any date with no
  requests
- **Real AI address verification** — OpenAI Responses API + the hosted
  `web_search` tool ONLY (no Google Places), runs automatically on every
  SDR submission and manual add, plus a "Re-run AI Check" button in the
  drawer. Fails gracefully to "unverified" with a clear message if
  `OPENAI_API_KEY` isn't set — never blocks a submission.

**One deliberate deviation from the mockup, flagged rather than silent:**
the Form Builder's "Add Field" panel has an extra "Allow multiple
selections" checkbox that isn't in the HTML mockup. The mockup never
exposed a way to set that per-field, but the backend schema needs it
(Glove Type and Color are multi-select, Size isn't) — without this checkbox,
every new dropdown field created here would default to single-select with
no way to change it.

**Still deferred:**
- The real HubSpot API integration (columns + stub UI + batch-sync
  plumbing exist; no live HubSpot calls)
- True drag-and-drop reordering in Form Builder (uses ↑↓ buttons, matching
  what the mockup itself does — it also has no real drag-and-drop despite
  `draggable="true"` on the rows)
- CSV/Excel export (the Export button renders but isn't wired — the mockup
  doesn't wire it either)
- Migrating `frontend/src/config/sdrs.js` off entirely — `GET /api/sdrs`
  works and Samples already uses it, but Quotes/POs still read the old
  hardcoded array

## AI address verification — setup

Add to `backend/.env`:
```
OPENAI_API_KEY=sk-...
```
No key set → every request stays "Unverified" with a note explaining why,
and "Re-run AI Check" tells you it's not configured, rather than erroring.
Tune the match confidence threshold in
`app/services/address_verification_service.py` (`CONFIDENCE_THRESHOLD`,
currently 75) after watching a week of real results.
