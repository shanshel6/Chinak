@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Product Audit ^& Fix (DeepSeek-V4-Flash)

REM Get the absolute path to the server directory
set "ROOT_DIR=%~dp0"
set "SERVER_DIR=%ROOT_DIR%server"

echo(
echo ============================================================
echo    Product Audit ^& Fix  (Arabic + English)
echo    Model : deepseek-ai/DeepSeek-V4-Flash
echo    Source: Goofish DB (postgresql://railway)
echo ============================================================
echo(

REM ============================================================
REM   STANDARD SETTINGS - edit these to change behavior
REM ============================================================

REM How many products to process in this run.
REM   Use 0 to process ALL products (will take a while).
REM   Currently set to 0 to process ALL products one by one.
set AUDIT_LIMIT=0

REM Skip the first N products (id order). Use this to resume
REM after a previous run, e.g. AUDIT_START=500 to start at 501.
REM Leave empty to use progress file (with --resume flag), set to 0 to start from beginning
REM NOTE: When using --resume flag, leave this empty to resume from last saved progress
set AUDIT_START=

REM Number of parallel workers. 1 avoids rate limit issues.
REM Increase to 2 only if you see no failures.
set AUDIT_CONCURRENCY=1

REM Dry-run mode. Set to "true" to PREVIEW without writing
REM any changes to the database. Highly recommended for the
REM first run.
set AUDIT_DRY_RUN=false

REM Only-bad mode. Set to "true" to ONLY print products whose
REM name/description looks bad (no AI calls, no DB writes).
REM Useful for a quick scan to estimate the cleanup size.
set AUDIT_ONLY_BAD=false

REM Max tokens for the re-translation call. 600 is enough for
REM "titleAr" (8 words) + "descriptionAr" (2 sentences).
set AUDIT_MAX_TOKENS=600

REM ============================================================
REM   Build the args string
REM ============================================================

set "AUDIT_FLAGS="
if not "%AUDIT_LIMIT%"=="0" set "AUDIT_FLAGS=%AUDIT_FLAGS% --limit=%AUDIT_LIMIT%"
if not "%AUDIT_START%"=="" (
    set "AUDIT_FLAGS=%AUDIT_FLAGS% --start=%AUDIT_START%"
) else (
    REM No AUDIT_START set, use --resume to continue from last saved progress
    set "AUDIT_FLAGS=%AUDIT_FLAGS% --resume"
)
set "AUDIT_FLAGS=%AUDIT_FLAGS% --concurrency=%AUDIT_CONCURRENCY%"
set "AUDIT_FLAGS=%AUDIT_FLAGS% --max-tokens=%AUDIT_MAX_TOKENS%"
if /I "%AUDIT_DRY_RUN%"=="true"   set "AUDIT_FLAGS=%AUDIT_FLAGS% --dry-run"
if /I "%AUDIT_ONLY_BAD%"=="true"  set "AUDIT_FLAGS=%AUDIT_FLAGS% --only-bad"

REM ============================================================
REM   Environment
REM ============================================================

set NODE_ENV=development
set "DATABASE_URL=postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway?sslmode=require&connection_limit=3&pool_timeout=20&connect_timeout=120&keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=3"
set SILICONFLOW_API_KEY=sk-rvifroqhufvtwusmgitecntbnmtxecafomfdrxunpooowdcp
set SILICONFLOW_MODEL=google/gemma-4-26B-A4B-it

echo(
echo  Settings:
echo    AUDIT_LIMIT       = %AUDIT_LIMIT%
echo    AUDIT_START       = %AUDIT_START%
echo    AUDIT_CONCURRENCY = %AUDIT_CONCURRENCY%
echo    AUDIT_DRY_RUN     = %AUDIT_DRY_RUN%
echo    AUDIT_ONLY_BAD    = %AUDIT_ONLY_BAD%
echo    AUDIT_MAX_TOKENS  = %AUDIT_MAX_TOKENS%
echo(
echo  Final flags: %AUDIT_FLAGS%
echo(
echo  Press Ctrl+C within 3 seconds to cancel...
timeout /t 3 /nobreak >nul
echo(

REM ============================================================
REM   Run - use absolute path so it works from any directory
REM ============================================================

node "%SERVER_DIR%\scripts\audit-and-fix-products.js" %AUDIT_FLAGS%
set "RC=%ERRORLEVEL%"

echo(
if %RC% NEQ 0 (
    echo [ERROR] audit-and-fix-products.js exited with code %RC%
) else (
    echo [OK] Finished cleanly.
)
echo(

pause
exit /b %RC%