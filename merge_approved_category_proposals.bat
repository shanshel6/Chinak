@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if not exist "server\scripts\merge-approved-category-proposals.js" (
  echo [merge-category-proposals] Missing script: server\scripts\merge-approved-category-proposals.js
  echo.
  pause
  exit /b 1
)

echo [merge-category-proposals] Working directory: %CD%\server
echo [merge-category-proposals] Command: node scripts\merge-approved-category-proposals.js %*
echo.

pushd "server" >nul
node scripts\merge-approved-category-proposals.js %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

echo.
echo [merge-category-proposals] Proposal file: server\scripts\.assign-canonical-categories.proposals.json
echo [merge-category-proposals] Seed file: server\scripts\canonical-categories.seed.json
echo [merge-category-proposals] Done with exit code %EXIT_CODE%
echo.
pause
exit /b %EXIT_CODE%
