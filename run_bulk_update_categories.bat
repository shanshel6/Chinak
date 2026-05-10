@echo off
cd /d "%~dp0"
echo ========================================
echo   BULK CATEGORY NAME UPDATE
echo ========================================
echo.
echo This script will:
echo 1. Load all categories from seed file
echo 2. Update all products in database with new category names
echo.
pause
echo.
echo Starting bulk update...
echo.

cd server
node scripts\bulk-update-category-names.js
set "EXIT_CODE=%ERRORLEVEL%"

if errorlevel 1 (
  echo.
  echo ========================================
  echo   Bulk update failed with exit code %EXIT_CODE%
  echo ========================================
  echo.
  pause
  exit /b %EXIT_CODE%
)

echo.
echo ========================================
echo   Bulk update complete!
echo ========================================
echo.
pause
