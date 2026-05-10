@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo [assign-categories] Deleting progress file to start from beginning...
echo.

if exist "server\scripts\assign-categories-progress.json" (
  del "server\scripts\assign-categories-progress.json"
  echo [assign-categories] Progress file deleted.
) else (
  echo [assign-categories] No progress file found - starting fresh.
)

echo.
echo [assign-categories] Running category assignment from beginning...
echo.

call run_assign_categories.bat

echo.
echo [assign-categories] Done.
pause
