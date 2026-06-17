@echo off
echo Starting TinyCLIP product embedding...
cd /d "%~dp0"
node embed_products_tinyclip.cjs
echo.
echo Done!
pause
