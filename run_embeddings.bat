@echo off
echo =======================================================
echo     Product Image Embedding Backfill Script
echo =======================================================
echo.
echo This script will process all products in your database
echo that do not have an imageEmbedding yet.
echo It processes them in batches to avoid memory issues.
echo You can stop it at any time by pressing Ctrl+C.
echo If it stops, run it again and it will resume automatically.
echo To restart from the beginning, run: run_embeddings.bat reset
echo (or when prompted, choose N to resume)
echo.

cd /d "%~dp0server"

REM Set environment variables if needed
set "DATABASE_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway?sslmode=require&connection_limit=1&pool_timeout=120&connect_timeout=20"
set REEMBED_BATCH_SIZE=50
set REEMBED_MAX_ITEMS=100000
set REEMBED_QUERY_TIMEOUT_MS=90000
set REEMBED_UPDATE_TIMEOUT_MS=180000
set REEMBED_RETRY_COUNT=12
set REEMBED_CONCURRENCY=1
set REEMBED_RETRY_BACKOFF_MS=3000
set REEMBED_DB_PING_EVERY_CHUNK=0
set REEMBED_RECONNECT_EVERY_CHUNK=0
set REEMBED_DB_WAIT_MS=0
set REEMBED_PROGRESS_EVERY=5
set REEMBED_HEARTBEAT_MS=30000
set REEMBED_WATCHDOG_IDLE_SECONDS=600
set REEMBED_PROGRESS_FILE=%cd%\reembed_progress.json
set "REEMBED_RESET_PROGRESS="
set "REEMBED_FORCE_ALL="

if /I "%1"=="reset" set "REEMBED_RESET_PROGRESS=1"
if /I "%1"=="force" set "REEMBED_FORCE_ALL=1"

if "%~1"=="" (
  if exist "%REEMBED_PROGRESS_FILE%" (
    choice /C YN /N /M "Resume from last checkpoint? (Y/N): "
    if errorlevel 2 set "REEMBED_RESET_PROGRESS=1"
  )
  
  choice /C YN /N /M "Force update ALL products (re-process existing embeddings)? (Y/N): "
  if errorlevel 1 set "REEMBED_FORCE_ALL=1"
  if errorlevel 2 set "REEMBED_FORCE_ALL="
)
if defined REEMBED_RESET_PROGRESS (
  del /q "%REEMBED_PROGRESS_FILE%" >nul 2>&1
  echo Resetting progress: starting from the first product...
)

echo Starting embedding process...
powershell -ExecutionPolicy Bypass -File scripts\run-embeddings-watchdog.ps1 -NodeScript "scripts/reembed_product_images.js" -ProgressFile "reembed_progress.json" -IdleSeconds %REEMBED_WATCHDOG_IDLE_SECONDS%
set "RUN_EXIT=%ERRORLEVEL%"
if not "%RUN_EXIT%"=="0" (
  echo.
  echo Embeddings script failed with exit code %RUN_EXIT%.
  pause
  exit /b %RUN_EXIT%
)

echo.
echo =======================================================
echo     Finished processing
echo =======================================================
pause
