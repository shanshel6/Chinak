@echo off
cd /d %~dp0
echo Starting queue processor...
node server/scripts/process-product-queue.js
pause
