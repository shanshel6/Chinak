@echo off
echo Starting Goofish Scraper...
cd /d "%~dp0"
cd server
if not exist node_modules (
    echo Installing dependencies...
    npm install
)
echo.
echo Please follow the prompts to enter the Category URL.
echo.
set GOOFISH_KEYWORDS_PER_PRODUCT=30
set GOOFISH_AI_TITLE_MAX_CHARS=140
set GOOFISH_AI_SECOND_PASS_DESCRIPTION=false
node scripts/goofish-category-scraper.js
pause
