@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo [assign-categories] Resuming from previous progress (ID 20750)...
echo.

if exist "server\scripts\assign-categories-progress.json" (
  echo [assign-categories] Found progress file - will resume from last position.
) else (
  echo [assign-categories] Warning: No progress file found - starting from beginning.
)

echo.
echo [assign-categories] Running category assignment...
echo.

call run_assign_categories.bat

echo.
echo [assign-categories] Done.
pause
