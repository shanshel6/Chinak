@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "ENV_FILE=%ROOT%server\.env"

if exist "%ENV_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "K=%%A"
    set "V=%%B"
    if not "!K!"=="" (
      if not "!K:~0,1!"=="#" (
        for /f "tokens=* delims= " %%K in ("!K!") do set "K=%%K"
        for /f "tokens=* delims= " %%V in ("!V!") do set "V=%%V"
        if "!V:~0,1!"=="\"" if "!V:~-1!"=="\"" set "V=!V:~1,-1!"
        set "!K!=!V!"
      )
    )
  )
)

if not defined MEILI_HOST set "MEILI_HOST=http://127.0.0.1:7700"

set "MEILI_HTTP_ADDR=127.0.0.1:7700"
for /f "tokens=1-3 delims=/" %%a in ("%MEILI_HOST%") do (
  if not "%%c"=="" set "MEILI_HTTP_ADDR=%%c"
)

set "DB_PATH=%ROOT%server\meili_data"
if not exist "%DB_PATH%" mkdir "%DB_PATH%"

set "MEILI_EXE=%ROOT%server\meilisearch.exe"
if exist "%MEILI_EXE%" goto start_meili

where /q meilisearch.exe
if %ERRORLEVEL%==0 (
  set "MEILI_EXE=meilisearch.exe"
  goto start_meili
)

echo Meilisearch binary not found.
echo.
echo Download Meilisearch for Windows, then place meilisearch.exe here:
echo   %ROOT%server\meilisearch.exe
echo.
echo Official install docs:
echo   https://www.meilisearch.com/docs/learn/getting_started/installation
echo.
pause
exit /b 1

:start_meili
echo Starting Meilisearch on http://%MEILI_HTTP_ADDR%
echo Data path: %DB_PATH%
echo.

if defined MEILI_ADMIN_API_KEY (
  "%MEILI_EXE%" --http-addr "%MEILI_HTTP_ADDR%" --db-path "%DB_PATH%" --master-key "%MEILI_ADMIN_API_KEY%"
) else (
  "%MEILI_EXE%" --http-addr "%MEILI_HTTP_ADDR%" --db-path "%DB_PATH%"
)
