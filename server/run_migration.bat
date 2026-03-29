@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
echo =======================================================
echo SUPABASE TO RAILWAY DATABASE MIGRATION SCRIPT
echo =======================================================
echo.
echo Press any key to start the migration...
pause > nul

echo.
echo Setting Environment Variables...
set "DATABASE_URL=postgresql://postgres:wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu@viaduct.proxy.rlwy.net:34644/railway?sslmode=require&connect_timeout=20"
set "SOURCE_DATABASE_URL=postgresql://postgres.puxjtecjxfjldwxiwzrk:EwWtQxvpn0ZnUHme@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
> prisma\enable_vector.sql echo CREATE EXTENSION IF NOT EXISTS vector;

echo.
echo Step 1: Pushing database schema to Railway...
set /a RETRY=0
:retry_db_push
set /a RETRY+=1
echo Attempt !RETRY! of 12
echo [1/4] Generating schema SQL...
call npx.cmd prisma migrate diff --from-empty --to-schema-datamodel prisma\schema.prisma --script > prisma\schema_railway.sql
if not %ERRORLEVEL% EQU 0 (
  if %RETRY% GEQ 12 goto db_push_failed
  echo Failed to generate schema SQL. Retrying in 10 seconds...
  timeout /t 10 > nul
  goto retry_db_push
)
echo [2/4] Enabling pgvector extension...
call npx.cmd prisma db execute --file prisma\enable_vector.sql --url "%DATABASE_URL%" > nul 2> nul
echo [3/4] Applying schema SQL...
call npx.cmd prisma db execute --file prisma\schema_railway.sql --url "%DATABASE_URL%"
if %ERRORLEVEL% EQU 0 goto db_push_ok
(
  echo SELECT 1 FROM "User" LIMIT 1;
  echo SELECT 1 FROM "Product" LIMIT 1;
  echo SELECT 1 FROM "ProductImage" LIMIT 1;
  echo SELECT 1 FROM "ProductVariant" LIMIT 1;
  echo SELECT 1 FROM "Order" LIMIT 1;
  echo SELECT 1 FROM "StoreSettings" LIMIT 1;
) > prisma\check_schema.sql
call npx.cmd prisma db execute --file prisma\check_schema.sql --url "%DATABASE_URL%" > nul 2> nul
if %ERRORLEVEL% EQU 0 (
  echo Full schema already exists. Continuing...
  goto db_push_ok
)
echo [4/4] Partial schema detected. Running prisma db push to create missing tables...
call npx.cmd prisma db execute --file prisma\enable_vector.sql --url "%DATABASE_URL%" > nul 2> nul
echo Running db push with 180s timeout...
powershell -NoProfile -Command "$p=Start-Process -FilePath 'npx.cmd' -ArgumentList @('prisma','db','push','--accept-data-loss','--skip-generate') -NoNewWindow -PassThru; if($p.WaitForExit(180000)){exit $p.ExitCode}else{$p.Kill();exit 124}"
if %ERRORLEVEL% EQU 124 (
  echo db push timed out after 180 seconds.
)
if %ERRORLEVEL% EQU 0 goto db_push_ok
if %RETRY% GEQ 12 goto db_push_failed
echo Schema apply failed. Retrying in 10 seconds...
timeout /t 10 > nul
goto retry_db_push
:db_push_failed
echo.
echo ERROR: Could not push schema to Railway after 12 attempts.
echo Check Railway Postgres status, then run this file again.
pause
exit /b 1
:db_push_ok

echo.
echo Step 2: Starting the data transfer (This may take 15-30 minutes)...
echo Watchdog enabled: if no progress for 300 seconds, migration will auto-restart.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-migration-watchdog.ps1 -NodeScript "scripts/migrate_db.cjs" -ProgressFile "scripts/migrate-progress.json" -IdleSeconds 300
:migration_done

echo.
echo =======================================================
echo Migration Process Completed!
echo =======================================================
pause
