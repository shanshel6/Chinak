@echo off
cd /d "%~dp0"
echo Starting Goofish Link Checker...
echo.
node server/scripts/goofish-link-checker.js
set "GOOFISH_EXIT=%ERRORLEVEL%"
if errorlevel 1 (
  echo.
  echo Goofish checker failed with exit code %GOOFISH_EXIT%. Continuing to category assignment...
)
echo.
echo Running category assignment...
node server/scripts/assign-canonical-categories.js --batch-size=all --all-chunk=5 --timeout-ms=60000
if errorlevel 1 (
  echo.
  echo Category assignment failed. Press any key to exit.
  pause >nul
  exit /b 1
)
echo.
if "%GOOFISH_EXIT%"=="0" (
  echo Goofish check and category assignment complete. Press any key to exit.
) else (
  echo Category assignment complete. Goofish checker had errors (exit code %GOOFISH_EXIT%). Press any key to exit.
)
pause >nul
