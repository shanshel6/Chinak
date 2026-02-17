
@echo off
cd /d "%~dp0"
echo Starting Backend on port 5002...
set PORT=5002
set NODE_ENV=development
node server/index.js
pause
