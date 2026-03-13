@echo off
set GOOFISH_UPDATE_EXISTING=true
:: Default start ID is 1500
if "%1"=="" set GOOFISH_UPDATE_START_ID=1500
:: Default limit is very high (e.g. 100000) so it keeps going
if "%2"=="" set GOOFISH_UPDATE_LIMIT=100000
if "%3"=="" set GOOFISH_UPDATE_BATCH=20

:: Allow overrides via arguments: start_id limit batch_size
if not "%1"=="" set GOOFISH_UPDATE_START_ID=%1
if not "%2"=="" set GOOFISH_UPDATE_LIMIT=%2
if not "%3"=="" set GOOFISH_UPDATE_BATCH=%3

set GOOFISH_UPDATE_DELAY_MIN=800
set GOOFISH_UPDATE_DELAY_MAX=1600
set GOOFISH_UPDATE_PROGRESS_EVERY=10

echo Starting update from Product ID: %GOOFISH_UPDATE_START_ID%
echo Max products to process (Total Limit): %GOOFISH_UPDATE_LIMIT%
echo Items per database fetch (Batch Size): %GOOFISH_UPDATE_BATCH%

node server/scripts/goofish-category-scraper.js
pause
