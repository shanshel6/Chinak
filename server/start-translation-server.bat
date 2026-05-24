@echo off
echo Starting Local Translation Server...
cd /d "%~dp0"

echo Setting proxy for China network...
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890
echo Proxy set to: %HTTP_PROXY%

echo Installing dependencies...
call npm install --prefix . -g @huggingface/transformers express cors

echo Starting translation server...
node translation-server.js
pause
