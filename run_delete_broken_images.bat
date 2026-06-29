@echo off
setlocal
cd /d %~dp0

echo ========================================
echo   Delete Broken-Image Products
echo ========================================
echo.

set NODE_ENV=development
set DATABASE_URL=postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway?sslmode=require^&connection_limit=3^&pool_timeout=20^&connect_timeout=120^&keepalives=1^&keepalives_idle=30^&keepalives_interval=10^&keepalives_count=3

rem DRY RUN by default. To actually delete, pass --apply
rem Examples:
rem   run_delete_broken_images.bat
rem   run_delete_broken_images.bat --apply
rem   run_delete_broken_images.bat --apply --concurrency=40
rem   run_delete_broken_images.bat --limit=5000
rem
rem RESUMABLE: progress is checkpointed to server\scripts\delete-broken-progress.json.
rem If it stops (e.g. DB connection drops), just run the SAME command again and it
rem resumes — already-checked URLs and already-deleted products are skipped.
rem The checkpoint is auto-deleted when a run finishes. Pass --fresh to ignore it
rem and start over from scratch.

echo Mode: DRY RUN unless you pass --apply
echo Running: node server\scripts\delete-broken-image-products.js %*
echo.

node server\scripts\delete-broken-image-products.js %*

echo.
echo Done.
pause
