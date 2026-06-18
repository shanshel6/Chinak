@echo off
setlocal

REM ============================================================
REM  Goofish pipeline #1
REM
REM  Step 1: Scrape + queue products to %REPO_ROOT%\product-queue
REM          (no DB writes during scraping, fast + safe)
REM  Step 2: Insert every queued product into the database and
REM          generate the 512-dim image embedding using the SAME
REM          service the rest of the app uses (clipService.js,
REM          Xenova/clip-vit-base-patch32). This is what makes
REM          products appear in CLIP / hybrid search.
REM
REM  Usage:   run_goofish_pipeline.bat
REM
REM  Re-run is safe: existing products (by purchaseUrl) are
REM  updated, not duplicated. Successfully inserted queue files
REM  are deleted.
REM ============================================================

echo.
echo === [1/2] Scraping Goofish (queue mode, dir=product-queue) ===
echo.
cd /d "%~dp0"
set GOOFISH_USE_QUEUE=true
set GOOFISH_QUEUE_DIR=product-queue
node scripts\goofish-pipeline.js
if errorlevel 1 (
  echo.
  echo *** Scraping step failed. Aborting before insert step. ***
  exit /b 1
)

echo.
echo === [2/2] Inserting queued products into the database ===
echo.
node scripts\process_goofish_queue.js product-queue
if errorlevel 1 (
  echo.
  echo *** Insert step failed. Check logs above. ***
  exit /b 1
)

echo.
echo === Done! ===
echo.
endlocal
