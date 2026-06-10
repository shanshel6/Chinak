@echo off
echo ========================================
echo   Category Name Fixer
echo   AI-powered category renaming + embedding
echo ========================================
echo.
echo Usage:
echo   run_fix_category_names.bat           - Resume (skip already processed)
echo   run_fix_category_names.bat --reset   - Re-process ALL categories
echo   run_fix_category_names.bat --retry-failed - Retry only failed ones
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
echo Starting category name fixer...
echo.

node scripts\fix-category-names.cjs %*

echo.
echo Script finished.
pause
