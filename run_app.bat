
@echo off
cd /d "%~dp0"
echo Starting Backend and Frontend...
start "Backend Server" cmd /c "run_backend.bat --no-pause"
timeout /t 2 >nul
start "Frontend App" cmd /c "run_frontend.bat"
echo Done.
pause
