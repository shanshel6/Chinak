@echo off
echo ============================================
echo   Delete Products with Broken Images
echo ============================================
echo.
echo This script will:
echo 1. Scan all products for broken images (404)
echo 2. Delete products where ALL images are broken
echo 3. Keep products if even ONE image is valid
echo.
echo Press Ctrl+C to cancel, or press any key to continue...
pause > nul

cd /d "%~dp0server"
echo Running cleanup script...
node scripts/delete-broken-image-products.js --delete

echo.
echo ============================================
echo   Script completed!
echo ============================================
pause
