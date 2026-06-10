@echo off
echo ========================================
echo   Similar Category Detector ^& Merger
echo ========================================
echo.
echo Usage:
echo   run_merge_similar_categories.bat              - Dry run (preview only)
echo   run_merge_similar_categories.bat --auto        - Auto-merge duplicates
echo   run_merge_similar_categories.bat --threshold 0.80  - Custom threshold
echo.

cd /d "%~dp0\server"

set DATABASE_URL=postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway?sslmode=require^&connection_limit=10^&pool_timeout=300^&connect_timeout=120
set SILICONFLOW_API_KEY=sk-crnipdimfvvgrbbxtvmbrshaqtjdmujbvkpuoifcdxkcalwh

echo Checking database migration...
echo.
node scripts\add-category-name-embedding-column.cjs
if errorlevel 1 (
    echo Migration failed! Fix the error above before continuing.
    pause
    exit /b 1
)
echo.
echo Starting similar category detection...
echo.

node scripts\merge-similar-categories.js %*

echo.
echo Script finished.
pause