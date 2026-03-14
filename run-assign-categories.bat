@echo off
cd /d "%~dp0"
echo Running canonical category assignment...
echo.
node server/scripts/assign-canonical-categories.js --batch-size=all --all-chunk=5 --timeout-ms=60000
if errorlevel 1 (
  echo.
  echo Category assignment failed. Press any key to exit.
  pause >nul
  exit /b 1
)
echo.
echo Category assignment complete. Press any key to exit.
pause >nul
