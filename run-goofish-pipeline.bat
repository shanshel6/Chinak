@echo off
cd /d "%~dp0"
echo Starting Goofish Pipeline...
echo.
echo Killing existing node processes...
taskkill /F /IM node.exe 2>nul
echo Starting pipeline with environment variables...

:RESTART_LOOP
set SILICONFLOW_API_KEY=sk-crnipdimfvvgrbbxtvmbrshaqtjdmujbvkpuoifcdxkcalwh
set GOOFISH_AI_CALL_TIMEOUT_MS=60000
set GOOFISH_AI_RETRY_MAX_ATTEMPTS=3
set GOOFISH_AI_MODEL=Qwen/Qwen3-14B
set GOOFISH_DATABASE_URL=postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway?sslmode=require&connection_limit=4&pool_timeout=300&connect_timeout=120
set GOOFISH_LINKS_PER_TERM=150
set GOOFISH_DETAILS_LIMIT=5
set GOOFISH_MAX_PRODUCTS=150
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
  echo Pipeline failed with exit code %PIPELINE_EXIT%. Halting execution.
  pause >nul
  exit /b %PIPELINE_EXIT%
)
echo.
echo Pipeline complete. Press any key to exit.
pause >nul
