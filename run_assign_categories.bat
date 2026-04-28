@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if not exist "server\scripts\assign-canonical-categories.js" (
  echo [category-assign] Missing script: server\scripts\assign-canonical-categories.js
  echo.
  pause
  exit /b 1
)

if not exist "server\.env" (
  echo [category-assign] Missing file: server\.env
  echo [category-assign] Add your Railway DATABASE_URL there before running this tool.
  echo.
  pause
  exit /b 1
)

if "%CATEGORY_ASSIGN_MODEL%"=="" (
  set "CATEGORY_ASSIGN_MODEL=Qwen/Qwen3-8B"
)

set "BASE_ARGS=--batch-size=100 --use-ai --propose-categories --review-every=1800"
set "MODE_LABEL=DRY RUN"

if /I "%~1"=="dry" (
  set "MODE_LABEL=DRY RUN"
  set "BASE_ARGS=%BASE_ARGS% --dry-run"
  shift
) else (
  set "MODE_LABEL=APPLY"
)

echo [category-assign] Mode: %MODE_LABEL%
echo [category-assign] Model: %CATEGORY_ASSIGN_MODEL%
echo [category-assign] Working directory: %CD%\server
echo [category-assign] Command: node scripts\assign-canonical-categories.js %BASE_ARGS% %*
echo.

pushd "server" >nul
node scripts\assign-canonical-categories.js %BASE_ARGS% %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

echo.
echo [category-assign] Report file: server\scripts\.assign-canonical-categories.report.json
echo [category-assign] Proposal file: server\scripts\.assign-canonical-categories.proposals.json
echo [category-assign] Review file: server\scripts\.assign-canonical-categories.review.json
echo [category-assign] Done with exit code %EXIT_CODE%
echo.
pause
exit /b %EXIT_CODE%
