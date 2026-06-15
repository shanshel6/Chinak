@echo off
REM ============================================
REM Cleanup Broken Images Batch File
REM ============================================
REM This batch file checks all product images and deletes products with broken images.
REM
REM Usage:
REM   cleanup-broken-images.bat           - Dry run (default)
REM   cleanup-broken-images.bat --delete  - Actually delete products
REM   cleanup-broken-images.bat --help    - Show help
REM
REM Options:
REM   --delete      : Actually delete products (default is dry run)
REM   --batch=100   : Set batch size (default: 100)
REM   --help        : Show this help message
REM ============================================

echo.
echo ============================================
echo   Cleanup Broken Images
echo ============================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js and try again
    pause
    exit /b 1
)

REM Check if script exists
if not exist "scripts\delete-broken-image-products.js" (
    echo ❌ ERROR: Script not found: scripts\delete-broken-image-products.js
    echo Please make sure you're in the correct directory
    pause
    exit /b 1
)

REM Parse arguments
set DRY_RUN=true
set BATCH_SIZE=100
set SHOW_HELP=false

:parse_args
if "%1"=="" goto run_script
if "%1"=="--delete" (
    set DRY_RUN=false
    shift
    goto parse_args
)
if "%1"=="--help" (
    set SHOW_HELP=true
    shift
    goto parse_args
)
if "%1:~0,8%"=="--batch=" (
    set BATCH_SIZE=%1:~8%
    shift
    goto parse_args
)
shift
goto parse_args

:run_script
if "%SHOW_HELP%"=="true" goto show_help

echo 📊 Configuration:
if "%DRY_RUN%"=="true" (
    echo   Mode: DRY RUN (no products will be deleted)
) else (
    echo   Mode: DELETE MODE (products will be deleted)
)
echo   Batch size: %BATCH_SIZE%
echo.

if "%DRY_RUN%"=="false" (
    echo ⚠️  WARNING: This will permanently delete products!
    echo.
    echo You have 10 seconds to cancel (press Ctrl+C)...
    timeout /t 10 /nobreak >nul
    echo.
)

REM Run the Node.js script
echo 🚀 Starting image check...
echo.

if "%DRY_RUN%"=="true" (
    node scripts\delete-broken-image-products.js --batch=%BATCH_SIZE%
) else (
    node scripts\delete-broken-image-products.js --delete --batch=%BATCH_SIZE%
)

if %errorlevel% neq 0 (
    echo.
    echo ❌ Script failed with error code %errorlevel%
    pause
    exit /b %errorlevel%
)

echo.
echo ============================================
echo   Cleanup Completed
echo ============================================
echo.
echo ✅ Process finished successfully!
echo.
echo 📁 Check the generated JSON file for detailed statistics
echo.

pause
exit /b 0

:show_help
echo.
echo ============================================
echo   Cleanup Broken Images - Help
echo ============================================
echo.
echo This tool checks all product images and deletes products with broken images.
echo.
echo Usage:
echo   cleanup-broken-images.bat [options]
echo.
echo Options:
echo   --delete            Actually delete products (default is dry run)
echo   --batch=NUMBER      Set batch size (default: 100)
echo   --help              Show this help message
echo.
echo Examples:
echo   cleanup-broken-images.bat
echo     - Dry run: check images but don't delete anything
echo.
echo   cleanup-broken-images.bat --delete
echo     - Delete products with broken images
echo.
echo   cleanup-broken-images.bat --batch=50 --delete
echo     - Delete products with broken images, processing 50 at a time
echo.
echo What it does:
echo   1. Checks all product image URLs
echo   2. If an image returns 404 (Not Found), it's marked as broken
echo   3. If ALL images for a product are broken, the product is deleted
echo   4. If SOME images are broken but others are OK, the product is kept
echo.
echo Safety features:
echo   - Default is dry run mode (no deletion)
echo   - Requires --delete flag for actual deletion
echo   - Shows exactly what would be deleted first
echo   - Processes in batches to avoid memory issues
echo.
pause
exit /b 0