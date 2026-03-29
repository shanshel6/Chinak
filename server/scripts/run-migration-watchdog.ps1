param(
  [string]$NodeScript = "scripts/migrate_db.cjs",
  [string]$ProgressFile = "scripts/migrate-progress.json",
  [int]$IdleSeconds = 300
)

$scriptPath = Join-Path (Get-Location) $NodeScript
$progressPath = Join-Path (Get-Location) $ProgressFile
$attempt = 0

while ($true) {
  $attempt++
  Write-Host "Watchdog migration attempt $attempt"

  $proc = Start-Process -FilePath "node" -ArgumentList @($scriptPath) -NoNewWindow -PassThru
  $lastProgress = Get-Date

  while (-not $proc.HasExited) {
    Start-Sleep -Seconds 10
    if (Test-Path $progressPath) {
      $progressMtime = (Get-Item $progressPath).LastWriteTimeUtc
      if ($progressMtime -gt $lastProgress.ToUniversalTime()) {
        $lastProgress = Get-Date
      }
    }

    $idleFor = (Get-Date) - $lastProgress
    if ($idleFor.TotalSeconds -ge $IdleSeconds) {
      Write-Host "No migration progress for $IdleSeconds seconds. Restarting migration process..."
      try { Stop-Process -Id $proc.Id -Force } catch {}
      break
    }

    try { $proc.Refresh() } catch {}
  }

  try { $proc.Refresh() } catch {}
  if ($proc.HasExited -and $proc.ExitCode -eq 0) {
    Write-Host "Migration completed successfully."
    exit 0
  }

  Write-Host "Migration process ended unexpectedly. Restarting in 15 seconds..."
  Start-Sleep -Seconds 15
}
