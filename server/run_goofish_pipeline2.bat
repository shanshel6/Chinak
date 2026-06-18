@echo off
setlocal

REM ============================================================
REM  Goofish pipeline #2
REM
REM  Same as run_goofish_pipeline.bat but uses a separate queue
REM  directory (product-queue-2) so it can run in parallel with
REM  pipeline #1 without stepping on each other's data.
REM
REM  Step 1: Scrape + queue products to %REPO_ROOT%\product-queue-2
REM  Step 2: Insert every queued product into the database and
REM          generate the 512-dim image embedding using the SAME
REM          service the rest of the app uses (clipService.js,
REM          Xenova/clip-vit-base-patch32). This is what makes
REM          products appear in CLIP / hybrid search.
REM
REM  Usage:   run_goofish_pipeline2.bat
REM ============================================================

echo.
echo === [1/2] Scraping Goofish (queue mode, dir=product-queue-2) ===
echo.
cd /d "%~dp0"
set GOOFISH_USE_QUEUE=true
set GOOFISH_QUEUE_DIR=product-queue-2
node scripts\goofish-pipeline.js
if errorlevel 1 (
  echo.
  echo *** Scraping step failed. Aborting before insert step. ***
  exit /b 1
)

echo.
echo === [2/2] Inserting queued products into the database ===
echo.
node scripts\process_goofish_queue.js product-queue-2
if errorlevel 1 (
  echo.
  echo *** Insert step failed. Check logs above. ***
  exit /b 1
)

echo.
echo === Done! ===
echo.
endlocal
