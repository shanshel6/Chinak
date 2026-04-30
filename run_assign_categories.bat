@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if not exist "server\scripts\assign-categories-from-urls.js" (
  echo [category-assign] Missing script: server\scripts\assign-categories-from-urls.js
  echo.
  pause
  exit /b 1
)

if not exist "server\.env" (
  echo [category-assign] Missing file: server\.env
  echo [category-assign] Add your Railway DATABASE_URL and SILICONFLOW_API_KEY there before running this tool.
  echo.
  pause
  exit /b 1
)

if "%CATEGORY_ASSIGN_MODEL%"=="" (
  set "CATEGORY_ASSIGN_MODEL=Qwen/Qwen3-8B"
)

if "%CATEGORY_BATCH_SIZE%"=="" (
  set "CATEGORY_BATCH_SIZE=50"
)

if "%CATEGORY_DELAY_MS%"=="" (
  set "CATEGORY_DELAY_MS=1000"
)

if "%CATEGORY_API_TIMEOUT_MS%"=="" (
  set "CATEGORY_API_TIMEOUT_MS=120000"
)

if /I "%~1"=="skip" (
  set "CATEGORY_FORCE_ALL=0"
  echo [MODE] SKIP: Only processing uncategorized products
  shift
) else (
  set "CATEGORY_FORCE_ALL=1"
  echo [MODE] FORCE ALL: Re-processing ALL products and discovering new categories
)

echo ========================================
echo   CATEGORY ASSIGNMENT FROM URLS
echo ========================================
echo.
echo How it works:
echo   1. Checks each product's URL for categoryId
echo   2. If found: uses mapping or creates new category via AI
echo   3. If not found: uses AI on product title to suggest category
echo   4. AI generates Arabic and English category names
echo.
echo Settings:
echo   Model: %CATEGORY_ASSIGN_MODEL%
echo   Batch Size: %CATEGORY_BATCH_SIZE%
echo   Delay: %CATEGORY_DELAY_MS%ms
echo   API Timeout: %CATEGORY_API_TIMEOUT_MS%ms
echo   Force All: %CATEGORY_FORCE_ALL%
echo.
echo To skip already-categorized products, run with "skip" argument:
echo   run_assign_categories.bat skip
echo.

cd server
node scripts\assign-categories-from-urls.js
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo ========================================
echo   Done with exit code %EXIT_CODE%
echo ========================================
echo.
pause
exit /b %EXIT_CODE%
