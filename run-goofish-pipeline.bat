@echo off
cd /d "%~dp0"
echo Starting Goofish Pipeline...
echo.
echo Killing existing node processes...
taskkill /F /IM node.exe 2>nul
echo Starting pipeline with environment variables...

set /a RESTART_COUNT=0

:RESTART_LOOP
set /a RESTART_COUNT+=1
if %RESTART_COUNT% GTR 10 (
    echo.
    echo ========================================
    echo   Pipeline failed 10 times. Stopping.
    echo   Check your network and try again.
    echo ========================================
    pause >nul
    exit /b 1
)
set SILICONFLOW_API_KEY=sk-crnipdimfvvgrbbxtvmbrshaqtjdmujbvkpuoifcdxkcalwh
set GOOFISH_AI_CALL_TIMEOUT_MS=30000
set GOOFISH_AI_RETRY_MAX_ATTEMPTS=10
set GOOFISH_AI_MODEL=Qwen/Qwen3-8B
set GOOFISH_CUSTOM_TERMS_FILE=custom-search-terms.json
set GOOFISH_DATABASE_URL=postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway?sslmode=require&connection_limit=4&pool_timeout=300&connect_timeout=120
set GOOFISH_LINKS_PER_TERM=30
set GOOFISH_DETAILS_LIMIT=5
set GOOFISH_MAX_PRODUCTS=150
set GOOFISH_MAX_PAGES=3
set GOOFISH_ESTIMATED_ITEMS_PER_PAGE=40

REM Only reset terms on the first run (when history file doesn't exist)
if not exist "server\scripts\goofish-search-terms.json" (
    set GOOFISH_RESET_TERMS_ON_START=true
) else (
    set GOOFISH_RESET_TERMS_ON_START=false
)

node server\scripts\goofish-pipeline.js
set "PIPELINE_EXIT=%ERRORLEVEL%"

if %PIPELINE_EXIT% EQU 99 (
  echo.
  echo ========================================
  echo   Pipeline exited with restart code 99
  echo   Restarting pipeline...
  echo ========================================
  echo.
  timeout /t 3 /nobreak >nul
  goto RESTART_LOOP
)

if errorlevel 1 (
  echo.
  echo Pipeline failed with exit code %PIPELINE_EXIT%. Restarting in 15s...
  timeout /t 15 /nobreak >nul
  goto RESTART_LOOP
)
echo.
echo Pipeline complete. Press any key to exit.
pause >nul
