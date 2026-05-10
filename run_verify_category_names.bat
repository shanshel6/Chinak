@echo off
cd /d "%~dp0"
echo ========================================
echo   CATEGORY NAME VERIFICATION
echo ========================================
echo.
echo This script will:
echo 1. Load all categories from seed file
echo 2. Fetch up to 20 products per category
echo 3. Use AI to analyze products and verify category names
echo 4. Update category names if AI suggests better ones
echo 5. Save a report of all changes
echo.
echo API Key: %SILICONFLOW_API_KEY:~0,10%...
echo Model: Qwen/Qwen3-14B
echo.
pause
echo.
echo Starting verification...
echo.

:RESTART_LOOP
cd /d "%~dp0server"
node scripts\verify-category-names.js
set "EXIT_CODE=%ERRORLEVEL%"

if %EXIT_CODE% EQU 99 (
  echo.
  echo ========================================
  echo   Script exited with restart code 99
  echo   Restarting from saved progress...
  echo   Waiting 5 seconds for database to recover...
  echo ========================================
  echo.
  timeout /t 5 /nobreak >nul
  goto RESTART_LOOP
)

if errorlevel 1 (
  echo.
  echo ========================================
  echo   Verification failed with exit code %EXIT_CODE%
  echo ========================================
  echo.
  pause
  exit /b %EXIT_CODE%
)

echo.
echo ========================================
echo   Verification complete!
echo ========================================
echo.
echo Report saved to: server\scripts\category-name-verification-report.json
echo Categories saved to: server\scripts\canonical-categories.seed.json
echo.
pause
