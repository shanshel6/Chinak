@echo off
cd /d "%~dp0"
echo Starting Goofish Link Checker...
echo.
set "DATABASE_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway?sslmode=require&connection_limit=4&pool_timeout=300&connect_timeout=120"
set "DIRECT_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway?sslmode=require&connection_limit=4&pool_timeout=300&connect_timeout=120"
set "GOOFISH_DATABASE_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway?sslmode=require&connection_limit=4&pool_timeout=300&connect_timeout=120"
set GOOFISH_QUERY_TIMEOUT_MS=15000
set GOOFISH_RETRY_COUNT=2
set GOOFISH_RETRY_BACKOFF_MS=1000
set GOOFISH_BATCH_SIZE=10
set GOOFISH_ID_SCAN_BATCH=100
set GOOFISH_RECONNECT_EVERY_BATCH=0
set GOOFISH_FETCH_TIMEOUT_MS=15000
set GOOFISH_FETCH_RETRY_COUNT=2
set GOOFISH_MUTATION_TIMEOUT_MS=15000
set GOOFISH_MUTATION_RETRY_COUNT=2
set GOOFISH_DB_STATEMENT_TIMEOUT_MS=15000
set GOOFISH_DB_WAIT_MS=15000
set GOOFISH_DB_COOLDOWN_WINDOW_MS=120000
set GOOFISH_DB_COOLDOWN_THRESHOLD=4
set GOOFISH_DB_COOLDOWN_SLEEP_MS=15000
set GOOFISH_DB_RECOVER_WAIT_MS=5000
set GOOFISH_DB_RECOVER_PING_TIMEOUT_MS=5000
set SILICONFLOW_API_KEY=sk-crnipdimfvvgrbbxtvmbrshaqtjdmujbvkpuoifcdxkcalwh
set SILICONFLOW_MODEL=Qwen/Qwen3.5-9B
set GOOFISH_AI_MODEL=Qwen/Qwen3.5-9B
set GOOFISH_AI_CALL_TIMEOUT_MS=45000
set GOOFISH_AI_RETRY_MAX_ATTEMPTS=10
set GOOFISH_AI_RATE_LIMIT_DELAY_MS=200
if not defined GOOFISH_HEADLESS set GOOFISH_HEADLESS=0
set GOOFISH_USE_CHROME_PROFILE=0
set PROXY_SERVER=http://127.0.0.1:7890
set "GOOFISH_PROGRESS_FILE=%~dp0server\goofish-checker-progress.json"
set GOOFISH_NO_PROMPT=1
echo Progress file: %GOOFISH_PROGRESS_FILE%
echo Browser mode: %GOOFISH_HEADLESS% ^(1=headless, 0=visible^)
echo.
:RESTART_LOOP
node server/scripts/goofish-link-checker.js
set "GOOFISH_EXIT=%ERRORLEVEL%"

if %GOOFISH_EXIT% EQU 99 (
  echo.
  echo ========================================
  echo   Script exited with restart code 99
  echo   Restarting from saved progress...
  echo ========================================
  echo.
  timeout /t 3 /nobreak >nul
  goto RESTART_LOOP
)

if errorlevel 1 (
  echo.
  echo Goofish checker failed with exit code %GOOFISH_EXIT%. Halting execution.
  pause >nul
  exit /b %GOOFISH_EXIT%
)
echo.
echo Goofish availability check complete. Press any key to exit.
pause >nul
