@echo off
setlocal EnableDelayedExpansion
title Pinduoduo Scraper
color 0A

:: Change directory to project root
cd /d "%~dp0"
set "PDD_PROFILE_FRESH=1"
set "PDD_SKIP_COOKIES=1"
set "PDD_IDLE_AFTER_LOGIN_MS=15000"
set "PDD_EDGE_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if not exist "%PDD_EDGE_PATH%" set "PDD_EDGE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set "PDD_USER_DATA_DIR=%LOCALAPPDATA%\Microsoft\Edge\User Data"

echo ========================================================
echo        Pinduoduo Product Scraper & Importer
echo ========================================================
echo.
echo This tool will:
echo 1. Open a Microsoft Edge browser controlled by automation
echo 2. Scrape products from the Pinduoduo category you provide
echo 3. Translate content to Arabic using AI
echo 4. Insert products directly into your local database
echo.

:: Check if URL was passed as an argument
if "%~1" neq "" (
    echo Launching with provided URL...
    node ..\server\scripts\pinduoduo-scraper.js "%~1"
) else (
    echo Please paste the Pinduoduo Category/Search URL below:
    echo (Right-click to paste in CMD/PowerShell)
    echo.
    set /p "url=URL: "
    echo.
    
    if "!url!"=="" (
        echo No URL provided. Running in default interactive mode...
        node ..\server\scripts\pinduoduo-scraper.js
    ) else (
        echo Starting scraper with provided URL...
        echo Target: "!url!"
        echo.
        node ..\server\scripts\pinduoduo-scraper.js "!url!"
    )
)

echo.
echo Scraper finished.
pause
