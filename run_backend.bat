
@echo off
cd /d "%~dp0"
set NOPAUSE=0
if /I "%~1"=="--no-pause" set NOPAUSE=1
set PORT=5001
set FOUND_PORT=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:":%PORT%" ^| findstr LISTENING') do (
  set FOUND_PORT=1
  echo Port %PORT% is in use by PID %%a. Stopping it...
  taskkill /F /PID %%a >nul 2>nul
)
if "%FOUND_PORT%"=="1" timeout /t 1 >nul
echo Starting Backend on port %PORT%...
set NODE_ENV=development
node server/index.js
set EXITCODE=%ERRORLEVEL%
if "%NOPAUSE%"=="0" pause
exit /b %EXITCODE%
