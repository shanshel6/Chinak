@echo off
REM ============================================
REM Check and Delete Broken Images
REM ============================================
REM Simple batch file to check product images and delete broken ones
REM
REM Usage:
REM   check-and-delete-broken.bat        - Dry run (check only)
REM   check-and-delete-broken.bat delete - Actually delete
REM ============================================

echo.
echo ============================================
echo   Check and Delete Broken Images
echo ============================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ ERROR: Node.js is not installed!
    echo Please install Node.js and try again.
    pause
    exit /b 1
)

REM Check if we're in the right directory
if not exist "scripts\fast-image-check.js" (
    echo ❌ ERROR: Script not found!
    echo Please run this from the server directory.
    echo Current directory: %CD%
    pause
    exit /b 1
)

REM Check argument
set MODE=dry
if "%1"=="delete" (
    set MODE=delete
    echo ⚠️  WARNING: DELETE MODE - Products will be permanently deleted!
    echo.
    echo You have 5 seconds to cancel (press Ctrl+C)...
    timeout /t 5 /nobreak >nul
    echo.
)

echo 📊 Starting image check...
echo.

if "%MODE%"=="dry" (
    echo 🔍 Running in DRY RUN mode (no deletion)...
    echo.
    node scripts/fast-image-check.js --test
) else (
    echo 🗑️  Running in DELETE mode...
    echo.
    node scripts/fast-image-check.js --delete
)

if %errorlevel% neq 0 (
    echo.
    echo ❌ Script failed with error code %errorlevel%
    pause
    exit /b %errorlevel%
)

echo.
echo ============================================
echo   Process Complete
echo ============================================
echo.
echo ✅ Finished checking product images.
echo.
echo 📝 Next steps:
if "%MODE%"=="dry" (
    echo   1. Review the results above
    echo   2. If you want to delete broken products, run:
    echo      check-and-delete-broken.bat delete
) else (
    echo   1. Broken products have been deleted
    echo   2. Consider running periodic checks
)
echo.
pause
exit /b 0