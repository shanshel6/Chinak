@echo off
echo =======================================================
echo     Product Image Embedding Backfill Script
echo =======================================================
echo.
echo This script will process all products in your database
echo that do not have an imageEmbedding yet.
echo It processes them in batches to avoid memory issues.
echo You can stop it at any time by pressing Ctrl+C.
echo If it stops, run it again and it will resume automatically.
echo To restart from the beginning, run: run_embeddings.bat reset
echo (or when prompted, choose N to resume)
echo.

cd /d "%~dp0server"

REM Set environment variables if needed
set REEMBED_BATCH_SIZE=100
set REEMBED_MAX_ITEMS=100000
set REEMBED_PROGRESS_FILE=%cd%\reembed_progress.json
set "REEMBED_RESET_PROGRESS="
set "REEMBED_FORCE_ALL="

if /I "%1"=="reset" set "REEMBED_RESET_PROGRESS=1"
if /I "%1"=="force" set "REEMBED_FORCE_ALL=1"

if "%~1"=="" (
  if exist "%REEMBED_PROGRESS_FILE%" (
    choice /C YN /N /M "Resume from last checkpoint? (Y/N): "
    if errorlevel 2 set "REEMBED_RESET_PROGRESS=1"
  )
  
  choice /C YN /N /M "Force update ALL products (re-process existing embeddings)? (Y/N): "
  if errorlevel 1 set "REEMBED_FORCE_ALL=1"
  if errorlevel 2 set "REEMBED_FORCE_ALL="
)
if defined REEMBED_RESET_PROGRESS (
  del /q "%REEMBED_PROGRESS_FILE%" >nul 2>&1
  echo Resetting progress: starting from the first product...
)

echo Starting embedding process...
node scripts/reembed_product_images.js

echo.
echo =======================================================
echo     Finished processing
echo =======================================================
pause
