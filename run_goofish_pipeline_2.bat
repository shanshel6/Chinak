@echo off
setlocal EnableDelayedExpansion
cd /d %~dp0

echo ========================================
echo   Pipeline 2 - Custom Search Terms
echo ========================================
echo.
node read-terms.cjs custom-search-terms-2.json
if %ERRORLEVEL% NEQ 0 (
    echo Failed to read terms. Exiting.
    pause
    exit /b 1
)
echo.
set NODE_ENV=development
set DATABASE_URL=postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway?sslmode=require^&connection_limit=10^&pool_timeout=300^&connect_timeout=120^&keepalives=1^&keepalives_idle=30^&keepalives_interval=10^&keepalives_count=3
set GOOFISH_DATABASE_URL=postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway?sslmode=require^&connection_limit=10^&pool_timeout=300^&connect_timeout=120^&keepalives=1^&keepalives_idle=30^&keepalives_interval=10^&keepalives_count=3
set GOOFISH_USE_QUEUE=true
set GOOFISH_MUTATION_TIMEOUT_MS=15000
set GOOFISH_MUTATION_RETRY_COUNT=3
set GOOFISH_NEWOROLD_TIMEOUT_MS=8000
set GOOFISH_NEWOROLD_RETRY_COUNT=3
set GOOFISH_RETRY_BACKOFF_MS=500
set GOOFISH_PRODUCT_TIMEOUT_MS=120000
set GOOFISH_IMAGE_MUTATION_TIMEOUT_MS=10000
set GOOFISH_IMAGE_MUTATION_RETRY_COUNT=1
set GOOFISH_EMBEDDING_MUTATION_TIMEOUT_MS=8000
set GOOFISH_EMBEDDING_MUTATION_RETRY_COUNT=1
set GOOFISH_SPECS_MUTATION_TIMEOUT_MS=8000
set GOOFISH_SPECS_MUTATION_RETRY_COUNT=1
set GOOFISH_DB_SAVE_TIMEOUT_MS=20000
set GOOFISH_DB_SAVE_RETRIES=3
set GOOFISH_DB_SAVE_FATAL_ON_RETRY_EXHAUST=false
set GOOFISH_DB_SAVE_BACKOFF_MS=500
set GOOFISH_DB_CONNECT_TIMEOUT_MS=60000
set GOOFISH_DB_CONNECT_RETRIES=3
set GOOFISH_DB_CONNECT_RETRY_DELAY_MS=5000
set GOOFISH_DB_CONNECT_VERIFY_PING=true
set GOOFISH_DB_ENGINE_FAILURE_THRESHOLD=3
set GOOFISH_DB_ENGINE_FAILURE_WINDOW_MS=120000
set GOOFISH_DB_ENGINE_COOLDOWN_MS=45000
set GOOFISH_DB_FORCE_RECONNECT_MIN_INTERVAL_MS=45000
set GOOFISH_PROGRESS_STALL_TIMEOUT_MS=240000
set GOOFISH_PROGRESS_WATCHDOG_INTERVAL_MS=10000
set GOOFISH_PROGRESS_RECOVERY_COOLDOWN_MS=30000
set GOOFISH_PROGRESS_STALL_MAX_RECOVERS=3
set GOOFISH_PROGRESS_STALL_HARD_EXIT_MS=360000
set GOOFISH_PROCESS_LINK_TIMEOUT_MS=120000
set GOOFISH_DB_RECOVER_WAIT_MS=8000
set GOOFISH_DB_RECOVER_PING_TIMEOUT_MS=12000
set GOOFISH_DB_RECOVER_MAX_CYCLES_PER_OP=1
set GOOFISH_AI_CALL_TIMEOUT_MS=30000
set GOOFISH_AI_RETRY_MAX_ATTEMPTS=10
set SILICONFLOW_API_KEY=sk-sbkaquplmslwtqghchtceehtkluvpjuarqvnffwkbfvnflfu
set SILICONFLOW_MODEL=Qwen/Qwen3-8B
set GOOFISH_AI_MODEL=Qwen/Qwen3-8B
set GOOFISH_AI_SECOND_PASS_DESCRIPTION=true
set GOOFISH_ENABLE_TRANSLATION_RETRY=false
set GOOFISH_SKIP_ON_TRANSLATION_FAILURE=true
rem Only reset terms on the first run (when progress file doesn't exist)
if not exist "%~dp0pipeline-2-progress.json" (
    set GOOFISH_RESET_TERMS_ON_START=true
) else (
    set GOOFISH_RESET_TERMS_ON_START=false
)
set GOOFISH_ITEMS_PER_SEARCH=30
set GOOFISH_LINKS_PER_TERM=30
set GOOFISH_TERMS_PER_BATCH=1
set GOOFISH_MAX_PAGES=3
set GOOFISH_ESTIMATED_ITEMS_PER_PAGE=40
set GOOFISH_OUTPUT_JSON=true
set GOOFISH_BATCH_INSERT_FROM_JSON=false
set GOOFISH_DISABLE_IMAGE_EMBEDDINGS=false
set GOOFISH_ACCUMULATE_PER_PRODUCT=true
set GOOFISH_EMBED_USE_PRODUCT_NAME=true
set GOOFISH_CUSTOM_TERMS_FILE=custom-search-terms-2.json
set GOOFISH_QUEUE_DIR=product-queue-2
set CLIP_WARMUP=true
set CLIP_MAX_IMAGE_SIDE=1024
set CLIP_ENABLE_RESIZE=false

echo [Pipeline 2] Using SILICONFLOW_API_KEY: %SILICONFLOW_API_KEY%
echo Starting queue processor in background...
start "" cmd /k "cd /d %~dp0 && node server\scripts\process-product-queue.js"
timeout /t 3 /nobreak

node server\scripts\goofish-pipeline.js
