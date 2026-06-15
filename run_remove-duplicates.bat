@echo off
cd /d "%~dp0"
echo ========================================
echo  Remove Duplicate Products Script
echo ========================================
echo.
cd server
node remove-duplicate-products.js
echo.
echo Done!
pause
