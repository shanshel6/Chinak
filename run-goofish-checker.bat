@echo off
cd /d "%~dp0"
echo Starting Goofish Link Checker...
echo.
set "DATABASE_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway?sslmode=require&connection_limit=3&pool_timeout=120&connect_timeout=20"
set "DIRECT_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway?sslmode=require&connection_limit=3&pool_timeout=120&connect_timeout=20"
set "GOOFISH_DATABASE_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway?sslmode=require&connection_limit=3&pool_timeout=120&connect_timeout=20"
set GOOFISH_QUERY_TIMEOUT_MS=120000
set GOOFISH_RETRY_COUNT=12
set GOOFISH_RETRY_BACKOFF_MS=3000
set GOOFISH_BATCH_SIZE=20
set GOOFISH_ID_SCAN_BATCH=300
set GOOFISH_RECONNECT_EVERY_BATCH=0
set GOOFISH_FETCH_TIMEOUT_MS=20000
set GOOFISH_FETCH_RETRY_COUNT=3
set GOOFISH_MUTATION_TIMEOUT_MS=10000
set GOOFISH_MUTATION_RETRY_COUNT=3
set GOOFISH_DB_STATEMENT_TIMEOUT_MS=22000
set GOOFISH_DB_WAIT_MS=0
set GOOFISH_DB_COOLDOWN_WINDOW_MS=120000
set GOOFISH_DB_COOLDOWN_THRESHOLD=4
set GOOFISH_DB_COOLDOWN_SLEEP_MS=15000
set GOOFISH_DB_RECOVER_WAIT_MS=120000
set GOOFISH_DB_RECOVER_PING_TIMEOUT_MS=12000
if not defined GOOFISH_HEADLESS set GOOFISH_HEADLESS=0
set "GOOFISH_PROGRESS_FILE=%~dp0server\goofish-checker-progress.json"
set GOOFISH_NO_PROMPT=1
if exist "%GOOFISH_PROGRESS_FILE%" del /q "%GOOFISH_PROGRESS_FILE%" >nul 2>&1
echo Progress reset. Checker will start from Product ID 1.
echo Browser mode: %GOOFISH_HEADLESS% ^(1=headless, 0=visible^)
echo.
node server/scripts/goofish-link-checker.js
set "GOOFISH_EXIT=%ERRORLEVEL%"
if errorlevel 1 (
  echo.
  echo Goofish checker failed with exit code %GOOFISH_EXIT%. Halting execution.
  pause >nul
  exit /b %GOOFISH_EXIT%
)
echo.
echo Goofish availability check complete. Press any key to exit.
pause >nul
