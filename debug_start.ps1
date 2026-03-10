Start-Transcript -Path "debug_log.txt"
Write-Host "Starting node..."
try {
    & node server/index.js
} catch {
    Write-Host "Error: $_"
}
Stop-Transcript