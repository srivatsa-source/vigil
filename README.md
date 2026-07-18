# Vigil - AI Order Supervisor (Phase 2)

This is the proof-of-concept for the long-running AI order supervisor, now fully integrated with Groq LLM, PostgreSQL persistence, and a Next.js UI!

## Prerequisites
- Docker and Docker Compose
- Python 3.10+
- Node.js 18+

## Quick Start (Windows)

We have provided a convenient `start.ps1` script that will automatically start the FastAPI server, the Temporal Worker, and the Next.js Frontend.

### 1. Start Infrastructure (Temporal + Postgres)
Run the following command to start Temporal and Postgres in the background:
```bash
docker compose up -d
```
You can access the Temporal Web UI at [http://localhost:8233](http://localhost:8233).

### 2. Start Application Services
Open a PowerShell terminal in this directory and run:
```powershell
.\start.ps1
```
*(If you get a script execution policy error, you can run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` first).*

### 3. Open the Dashboard
Navigate to [http://localhost:3000](http://localhost:3000) in your browser.
1. Click **Initialize Template** if there are no supervisors.
2. Enter an Order ID and click **Start**.
3. Click on the newly created run to open the detailed view.
4. Try injecting events like `payment_failed` or `shipment_delayed` and watch the AI agent wake up, update its memory, and execute tools!

---

## Manual Startup (Mac/Linux)

If you are not on Windows, you can start the services manually in separate terminals:

1. **Temporal & Postgres:** `docker compose up -d`
2. **Backend API:** `source .venv/bin/activate` then `uvicorn backend.main:app --reload`
3. **Temporal Worker:** `source .venv/bin/activate` then `python backend/worker.py`
4. **Frontend:** `cd frontend` then `npm run dev`
