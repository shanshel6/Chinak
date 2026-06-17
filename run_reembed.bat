@echo off
chcp 65001 >nul 2>&1
title Re-embed Products — BGE-M3 (Resumable)

echo ============================================================
echo   Re-embed Products with BGE-M3 (1024-dim)
echo   Using Local Ollama
echo   * Auto-resumes from last checkpoint
echo ============================================================
echo.

cd /d "%~dp0server"

REM ── Check Ollama is running ─────────────────────────────────────
echo [1/3] Checking Ollama...
curl -s -X POST http://127.0.0.1:11434/api/embeddings -H "Content-Type: application/json" -d "{\"model\":\"bge-m3\",\"prompt\":\"test\"}" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Ollama is not running!
    echo.
    echo Please start Ollama first:
    echo   1. Open Ollama from Start Menu, OR
    echo   2. Run: ollama serve
    echo.
    echo Then run this script again.
    echo.
    pause
    exit /b 1
)
echo        Ollama is running ✓
echo.

REM ── Check .env exists ───────────────────────────────────────────
echo [2/3] Checking environment...
if not exist ".env" (
    echo [ERROR] .env file not found in server folder!
    pause
    exit /b 1
)
echo        .env found ✓
echo.

REM ── Start re-embedding (resumable) ──────────────────────────────
echo [3/3] Starting re-embedding with BGE-M3...
echo.
echo Options:
echo   [1] Default  (batch=100, concurrent=5)
echo   [2] Fast     (batch=200, concurrent=10)
echo   [3] Custom
echo.

set /p choice="Choose option (1/2/3): "

if "%choice%"=="1" (
    echo.
    echo Starting with default settings...
    node reembed_all.cjs --batch-size=100 --concurrent=5
) else if "%choice%"=="2" (
    echo.
    echo Starting with fast settings...
    node reembed_all.cjs --batch-size=200 --concurrent=10
) else if "%choice%"=="3" (
    set /p bs="Enter batch size (default 100): "
    if "%bs%"=="" set bs=100
    set /p cc="Enter concurrency (default 5): "
    if "%cc%"=="" set cc=5
    echo.
    echo Starting with batch=%bs%, concurrent=%cc%...
    node reembed_all.cjs --batch-size=%bs% --concurrent=%cc%
) else (
    echo.
    echo Invalid choice. Using defaults...
    node reembed_all.cjs --batch-size=100 --concurrent=5
)

echo.
echo Done!
pause
