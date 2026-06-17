@echo off
chcp 65001 >nul 2>&1
title Re-embed Product Images — CLIP (Resumable)

echo ============================================================
echo   Re-embed Product Images with CLIP (512-dim)
echo   Using Local @xenova/transformers
echo   * Auto-resumes from last checkpoint
echo ============================================================
echo.

cd /d "%~dp0server"

REM ── Check .env exists ───────────────────────────────────────────
echo [1/2] Checking environment...
if not exist ".env" (
    echo [ERROR] .env file not found in server folder!
    pause
    exit /b 1
)
echo        .env found ✓
echo.

REM ── Start re-embedding (resumable) ──────────────────────────────
echo [2/2] Starting CLIP image embedding...
echo.
echo Options:
echo   [1] Default  (batch=50, concurrent=3)
echo   [2] Fast     (batch=100, concurrent=5)
echo   [3] Custom
echo.

set /p choice="Choose option (1/2/3): "

if "%choice%"=="1" (
    echo.
    echo Starting with default settings...
    node reembed_images_clip.cjs --batch-size=50 --concurrent=3
) else if "%choice%"=="2" (
    echo.
    echo Starting with fast settings...
    node reembed_images_clip.cjs --batch-size=100 --concurrent=5
) else if "%choice%"=="3" (
    set /p bs="Enter batch size (default 50): "
    if "%bs%"=="" set bs=50
    set /p cc="Enter concurrency (default 3): "
    if "%cc%"=="" set cc=3
    echo.
    echo Starting with batch=%bs%, concurrent=%cc%...
    node reembed_images_clip.cjs --batch-size=%bs% --concurrent=%cc%
) else (
    echo.
    echo Invalid choice. Using defaults...
    node reembed_images_clip.cjs --batch-size=50 --concurrent=3
)

echo.
echo Done!
pause
