@echo off
setlocal EnableDelayedExpansion
cd /d %~dp0

if not defined APP_URL set "APP_URL=https://chinak-production.up.railway.app"
if not defined MEILI_REINDEX_POLL_SECONDS set "MEILI_REINDEX_POLL_SECONDS=10"
if not defined MEILI_REINDEX_RETRY_DELAY_SECONDS set "MEILI_REINDEX_RETRY_DELAY_SECONDS=15"
if not defined MEILI_REINDEX_MAX_ATTEMPTS set "MEILI_REINDEX_MAX_ATTEMPTS=0"
if not defined MEILI_REINDEX_RESET set "MEILI_REINDEX_RESET=1"

set /a MEILI_REINDEX_ATTEMPT=0

:reindex_loop
set /a MEILI_REINDEX_ATTEMPT+=1
echo.
echo Starting Meili reindex attempt !MEILI_REINDEX_ATTEMPT! against %APP_URL%...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$root = Resolve-Path '.';" ^
  "$appUrl = [Environment]::GetEnvironmentVariable('APP_URL'); if ([string]::IsNullOrWhiteSpace($appUrl)) { $appUrl = 'https://chinak-production.up.railway.app' }" ^
  "$pollSeconds = 0; [void][int]::TryParse([Environment]::GetEnvironmentVariable('MEILI_REINDEX_POLL_SECONDS'), [ref]$pollSeconds); if ($pollSeconds -le 0) { $pollSeconds = 10 }" ^
  "$resetFlag = [Environment]::GetEnvironmentVariable('MEILI_REINDEX_RESET'); if ([string]::IsNullOrWhiteSpace($resetFlag)) { $resetFlag = '1' }" ^
  "$tokenOutput = & node (Join-Path $root 'server\generate-admin-token.js') 2>&1 | Out-String;" ^
  "$tokenMatch = [regex]::Match($tokenOutput, '(?m)^([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$');" ^
  "if (-not $tokenMatch.Success) { throw ('Failed to extract admin token.' + [Environment]::NewLine + $tokenOutput) }" ^
  "$token = $tokenMatch.Groups[1].Value;" ^
  "$headers = @{ Authorization = ('Bearer ' + $token) };" ^
  "$triggerUrl = $appUrl + '/api/admin/search/reindex'; if ($resetFlag -eq '1' -or $resetFlag -eq 'true') { $triggerUrl += '?reset=1' }" ^
  "Write-Host ('Triggering reindex...');" ^
  "$trigger = Invoke-RestMethod -Method Post -Uri $triggerUrl -Headers $headers;" ^
  "Write-Host ('Trigger response: ' + ($trigger | ConvertTo-Json -Compress -Depth 10));" ^
  "while ($true) {" ^
  "  Start-Sleep -Seconds $pollSeconds;" ^
  "  $status = Invoke-RestMethod -Method Get -Uri ($appUrl + '/api/admin/search/reindex-status') -Headers $headers;" ^
  "  Write-Host ('Status: ' + ($status | ConvertTo-Json -Compress -Depth 10));" ^
  "  if (-not $status.running) {" ^
  "    if ($status.lastError) { throw ('Reindex failed: ' + $status.lastError) }" ^
  "    Write-Host ('Reindex finished successfully.');" ^
  "    break" ^
  "  }" ^
  "}"

set "MEILI_REINDEX_EXIT=%ERRORLEVEL%"
if "%MEILI_REINDEX_EXIT%"=="0" goto reindex_done

echo.
echo Meili reindex attempt !MEILI_REINDEX_ATTEMPT! failed with exit code %MEILI_REINDEX_EXIT%.
if not "%MEILI_REINDEX_MAX_ATTEMPTS%"=="0" if !MEILI_REINDEX_ATTEMPT! GEQ %MEILI_REINDEX_MAX_ATTEMPTS% goto reindex_failed
echo Waiting %MEILI_REINDEX_RETRY_DELAY_SECONDS%s before retrying...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds %MEILI_REINDEX_RETRY_DELAY_SECONDS%"
goto reindex_loop

:reindex_failed
echo.
echo Meili reindex failed after !MEILI_REINDEX_ATTEMPT! attempts.
if /i "%MEILI_REINDEX_NO_PAUSE%"=="1" exit /b %MEILI_REINDEX_EXIT%
pause
exit /b %MEILI_REINDEX_EXIT%

:reindex_done
echo.
echo Meili reindex completed successfully.
if /i "%MEILI_REINDEX_NO_PAUSE%"=="1" exit /b 0
pause
exit /b 0
