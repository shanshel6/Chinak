@echo off
cd /d "%~dp0"
echo Starting Goofish Link Checker...
echo.
node server/scripts/goofish-link-checker.js
echo.
echo Check complete. Press any key to exit.
pause >nul
