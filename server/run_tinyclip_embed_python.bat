@echo off
echo Starting TinyCLIP product embedding (Python)...
cd /d "%~dp0"
python embed_products_tinyclip.py
echo.
echo Done!
pause
