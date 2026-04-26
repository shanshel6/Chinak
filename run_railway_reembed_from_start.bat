@echo off
setlocal EnableDelayedExpansion
cd /d %~dp0

if not defined DATABASE_URL set "DATABASE_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway"
if not defined HF_ENDPOINT set "HF_ENDPOINT=https://hf-mirror.com"
if not defined MAX_PRODUCT_IMAGE_EMBEDDINGS set "MAX_PRODUCT_IMAGE_EMBEDDINGS=4"
if not defined REEMBED_START_ID set "REEMBED_START_ID=600"
if not defined REEMBED_RESET_PROGRESS set "REEMBED_RESET_PROGRESS=0"
if not defined REEMBED_FORCE_ALL set "REEMBED_FORCE_ALL=1"
if not defined REEMBED_BATCH_SIZE set "REEMBED_BATCH_SIZE=25"
if not defined REEMBED_MAX_ITEMS set "REEMBED_MAX_ITEMS=1000000"
if not defined REEMBED_CONCURRENCY set "REEMBED_CONCURRENCY=1"
if not defined REEMBED_RETRY_COUNT set "REEMBED_RETRY_COUNT=5"
if not defined REEMBED_RETRY_BACKOFF_MS set "REEMBED_RETRY_BACKOFF_MS=1500"
if not defined REEMBED_QUERY_TIMEOUT_MS set "REEMBED_QUERY_TIMEOUT_MS=60000"
if not defined REEMBED_UPDATE_TIMEOUT_MS set "REEMBED_UPDATE_TIMEOUT_MS=120000"
if not defined REEMBED_DB_WAIT_MS set "REEMBED_DB_WAIT_MS=300000"
if not defined REEMBED_PROGRESS_EVERY set "REEMBED_PROGRESS_EVERY=1"
if not defined REEMBED_HEARTBEAT_MS set "REEMBED_HEARTBEAT_MS=30000"
if not defined REEMBED_PROGRESS_FILE set "REEMBED_PROGRESS_FILE=%~dp0reembed_railway_from_start.progress.json"

echo.
echo Starting Railway database image re-embed with resume enabled...
echo DATABASE_URL host: viaduct.proxy.rlwy.net
echo REEMBED_START_ID=%REEMBED_START_ID%
echo MAX_PRODUCT_IMAGE_EMBEDDINGS=%MAX_PRODUCT_IMAGE_EMBEDDINGS%
echo REEMBED_FORCE_ALL=%REEMBED_FORCE_ALL%
echo REEMBED_PROGRESS_FILE=%REEMBED_PROGRESS_FILE%
echo.

node "%~dp0server\scripts\reembed_product_images.js"
set "REEMBED_EXIT=%ERRORLEVEL%"

echo.
if "%REEMBED_EXIT%"=="0" (
  echo Railway re-embed finished successfully.
) else (
  echo Railway re-embed failed with exit code %REEMBED_EXIT%.
)

pause
exit /b %REEMBED_EXIT%
