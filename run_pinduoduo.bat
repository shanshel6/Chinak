@echo off
title Pinduoduo Scraper
color 0A

cd /d "%~dp0server"

echo ========================================================
echo        Pinduoduo Product Scraper & Importer
echo ========================================================
echo.
echo This tool will:
echo 1. Open a Chrome browser controlled by automation
echo 2. Scrape products from the Pinduoduo category you provide
echo 3. Translate content to Arabic using AI
echo 4. Insert products directly into your local database
echo.

:: Check if URL was passed as an argument (e.g. via command line)
if "%~1" neq "" (
    echo Launching with provided URL...
    node scripts/pinduoduo-scraper.js "%~1"
) else (
    :: Run in interactive mode
    node scripts/pinduoduo-scraper.js
)

echo.
echo Scraper finished.
pause
