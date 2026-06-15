@echo off
cd /d "%~dp0"
echo ========================================
echo  Product Image Cleanup Script
echo ========================================
echo.
cd server
node my-cleanup-with-save.cjs
echo.
echo Done!
pause
