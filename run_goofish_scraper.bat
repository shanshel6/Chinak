@echo off
echo Starting Goofish Scraper...
cd /d "%~dp0"
cd server
set "DATABASE_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway?sslmode=require&connect_timeout=20"
set "DIRECT_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway?sslmode=require&connect_timeout=20"
set "GOOFISH_DATABASE_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway?sslmode=require&connect_timeout=20&connection_limit=3&pool_timeout=120"
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
set GOOFISH_AI_TASK_TIMEOUT_MS=90000
set GOOFISH_DB_WRITE_TIMEOUT_MS=60000
set GOOFISH_SCRAPER_HEARTBEAT_MS=30000
set GOOFISH_DB_STATEMENT_TIMEOUT_MS=90000
set GOOFISH_DB_COOLDOWN_WINDOW_MS=120000
set GOOFISH_DB_COOLDOWN_THRESHOLD=4
set GOOFISH_DB_COOLDOWN_SLEEP_MS=15000
set GOOFISH_DB_RECOVER_WAIT_MS=0
set GOOFISH_DB_RECOVER_PING_TIMEOUT_MS=12000
node scripts/goofish-category-scraper.js
pause
