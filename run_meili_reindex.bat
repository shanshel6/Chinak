@echo off
setlocal EnableDelayedExpansion
cd /d %~dp0

if not defined APP_URL set "APP_URL=https://chinak-production.up.railway.app"
if not defined MEILI_REINDEX_POLL_SECONDS set "MEILI_REINDEX_POLL_SECONDS=10"
if not defined MEILI_REINDEX_RETRY_DELAY_SECONDS set "MEILI_REINDEX_RETRY_DELAY_SECONDS=15"
if not defined MEILI_REINDEX_MAX_ATTEMPTS set "MEILI_REINDEX_MAX_ATTEMPTS=0"
if not defined MEILI_REINDEX_RESET set "MEILI_REINDEX_RESET=0"
if not defined MEILI_REINDEX_RESET_ON_RETRY set "MEILI_REINDEX_RESET_ON_RETRY=0"
if not defined MEILI_REINDEX_REQUEST_TIMEOUT_MS set "MEILI_REINDEX_REQUEST_TIMEOUT_MS=30000"
if not defined MEILI_REINDEX_MAX_RUNNING_MINUTES set "MEILI_REINDEX_MAX_RUNNING_MINUTES=480"
if not defined MEILI_REINDEX_RESUME_FROM_ID set "MEILI_REINDEX_RESUME_FROM_ID=63250"
if not defined MEILI_REINDEX_RESUME_INDEXED set "MEILI_REINDEX_RESUME_INDEXED=53448"
if not defined MEILI_REINDEX_RESUME_PROCESSED_BATCHES set "MEILI_REINDEX_RESUME_PROCESSED_BATCHES=267"

node "%~dp0server\scripts\run-meili-railway-sync.js"
set "MEILI_REINDEX_EXIT=%ERRORLEVEL%"

if "%MEILI_REINDEX_EXIT%"=="0" (
  echo.
  echo Meili reindex completed successfully.
) else (
  echo.
  echo Meili reindex failed with exit code %MEILI_REINDEX_EXIT%.
)

if /i "%MEILI_REINDEX_NO_PAUSE%"=="1" exit /b %MEILI_REINDEX_EXIT%
pause
exit /b %MEILI_REINDEX_EXIT%
