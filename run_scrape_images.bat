@echo off
echo ========================================
echo   Product Image Scraper (one by one)
echo   Starting from product ID 40000
echo ========================================
echo.
echo   NOTE: Old cookies will be deleted.
echo   You will need to log in fresh every time.
echo.

cd /d "%~dp0\server"

echo Starting scraper...
echo.

node scripts\scrape-images-batch.js

echo.
echo Script finished.
pause
