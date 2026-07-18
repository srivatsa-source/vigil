Write-Host "Starting Vigil Services..." -ForegroundColor Cyan

# Check if .venv exists
if (-Not (Test-Path ".venv")) {
    Write-Host "Creating python virtual environment..." -ForegroundColor Yellow
    python -m venv .venv
    Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
    .\.venv\Scripts\pip install -r backend\requirements.txt
}

$root = $PSScriptRoot

# Read GROQ_API_KEY from backend\.env explicitly
$envFile = "$root\backend\.env"
$groqKey = ""
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^GROQ_API_KEY=(.+)$") { $groqKey = $Matches[1].Trim() }
    }
}

# Start Backend API
Write-Host "Starting FastAPI Backend on port 8000..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:PYTHONPATH='$root'; `$env:GROQ_API_KEY='$groqKey'; & '$root\.venv\Scripts\uvicorn.exe' backend.main:app --reload" -WorkingDirectory $root -WindowStyle Normal

# Start Temporal Worker — wrapped in a restart loop so it recovers from crashes
Write-Host "Starting Temporal Worker (with auto-restart)..." -ForegroundColor Green
$workerCmd = @"
`$env:PYTHONPATH = '$root'
`$env:GROQ_API_KEY = '$groqKey'
while (`$true) {
    Write-Host '[Worker] Starting...' -ForegroundColor Cyan
    & '$root\.venv\Scripts\python.exe' -m backend.worker
    Write-Host '[Worker] Exited. Restarting in 3 seconds...' -ForegroundColor Yellow
    Start-Sleep 3
}
"@
Start-Process powershell -ArgumentList "-NoExit", "-Command", $workerCmd -WorkingDirectory $root -WindowStyle Normal

# Clear stale Turbopack cache to prevent "Manifest file is empty" errors
if (Test-Path "$root\frontend\.next") {
    Write-Host "Clearing stale .next cache..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "$root\frontend\.next"
}

# Start Frontend
Write-Host "Starting Next.js Frontend on port 3000..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev" -WorkingDirectory "$root\frontend" -WindowStyle Normal

Write-Host ""
Write-Host "All services started!" -ForegroundColor Cyan
Write-Host "Open http://localhost:3000 in your browser." -ForegroundColor White
Write-Host "Temporal Worker has auto-restart enabled." -ForegroundColor DarkGray
