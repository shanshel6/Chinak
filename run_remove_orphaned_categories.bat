@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if not exist "server\scripts\remove_orphaned_categories.mjs" (
  echo [remove-orphaned] Missing script: server\scripts\remove_orphaned_categories.mjs
  echo.
  pause
  exit /b 1
)

echo [remove-orphaned] Removing orphaned categories from database...
echo [remove-orphaned] This will remove the 89 categories not in canonical-categories.seed.json
echo.

node server\scripts\remove_orphaned_categories.mjs

if %errorlevel% neq 0 (
  echo.
  echo [remove-orphaned] Script failed with error code %errorlevel%
  pause
  exit /b %errorlevel%
)

echo.
echo [remove-orphaned] Completed successfully
pause
