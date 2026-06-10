@echo off
cd /d %~dp0
echo ========================================
echo   Queue Processor - Pipeline 1 & 2
echo   Processing: product-queue, product-queue-2
echo ========================================
echo.
node server/scripts/process-product-queue.js
pause
