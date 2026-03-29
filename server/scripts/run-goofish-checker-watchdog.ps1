param(
  [string]$NodeScript = "server/scripts/goofish-link-checker.js",
  [string]$ProgressFile = "server/goofish-checker-progress.json",
  [int]$IdleSeconds = 120
)

$scriptPath = Join-Path (Get-Location) $NodeScript
$progressPath = Join-Path (Get-Location) $ProgressFile
$attempt = 0

while ($true) {
  $attempt++
  Write-Host "Watchdog checker attempt $attempt"

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
      Write-Host "No checker progress for $IdleSeconds seconds. Restarting checker process..."
      try { Stop-Process -Id $proc.Id -Force } catch {}
      break
    }

    try { $proc.Refresh() } catch {}
  }

  try { $proc.Refresh() } catch {}
  if ($proc.HasExited -and $proc.ExitCode -eq 0) {
    Write-Host "Checker completed successfully."
    exit 0
  }

  Write-Host "Checker process ended unexpectedly. Restarting in 10 seconds..."
  Start-Sleep -Seconds 10
}
