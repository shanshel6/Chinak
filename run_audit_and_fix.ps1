#Requires -Version 5.1
<#
.SYNOPSIS
    Product Audit & Fix using DeepSeek-V4-Flash
.DESCRIPTION
    Iterates over products in the database and:
      1. Checks if the product has any real (non-broken) image.
      2. Inspects existing name/description for bad translations and re-translates.
      3. Regenerates textEmbedding from the new Arabic name.
.PARAMETER Limit
    How many products to process (0 = all). Default: 500
.PARAMETER Start
    Skip the first N products. Default: 0
.PARAMETER Concurrency
    Number of parallel workers. Default: 3
.PARAMETER DryRun
    Preview without writing changes. Default: $false
.PARAMETER OnlyBad
    Only print products with bad names (no AI calls, no DB writes). Default: $false
.PARAMETER MaxTokens
    Max tokens for re-translation call. Default: 600
.EXAMPLE
    .\run_audit_and_fix.ps1
.EXAMPLE
    .\run_audit_and_fix.ps1 -Limit 100 -DryRun
.EXAMPLE
    .\run_audit_and_fix.ps1 -OnlyBad
#>

param(
    [int]$Limit = 500,
    [int]$Start = 23578,
    [int]$Concurrency = 3,
    [switch]$DryRun,
    [switch]$OnlyBad,
    [int]$MaxTokens = 600,
    [switch]$Resume
)

$ErrorActionPreference = "Stop"

# Navigate to the server directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $scriptDir "server"
Push-Location $serverDir

Write-Host ""
Write-Host "=" * 60
Write-Host "   Product Audit & Fix"
Write-Host "   Model : deepseek-ai/DeepSeek-V4-Flash"
Write-Host "   Source: Goofish DB (postgresql://railway)"
Write-Host "=" * 60
Write-Host ""

# Environment
$env:NODE_ENV = "development"
$env:DATABASE_URL = "postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway?sslmode=require&connection_limit=3&pool_timeout=20&connect_timeout=120&keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=3"
$env:SILICONFLOW_API_KEY = "sk-zdegdgqtzfiozbqiifmjolfoaxaucxwmpqsdynwrxcdessee"
$env:SILICONFLOW_MODEL = "deepseek-ai/DeepSeek-V4-Flash"

# Build flags
$flags = @()
if ($Limit -ne 0) { $flags += "--limit=$Limit" }
$flags += "--start=$Start"
$flags += "--concurrency=$Concurrency"
$flags += "--max-tokens=$MaxTokens"
$flags += "--resume"
if ($DryRun) { $flags += "--dry-run" }
if ($OnlyBad) { $flags += "--only-bad" }

Write-Host " Settings:"
Write-Host "   AUDIT_LIMIT       = $Limit"
Write-Host "   AUDIT_START       = $Start"
Write-Host "   AUDIT_CONCURRENCY = $Concurrency"
Write-Host "   AUDIT_DRY_RUN     = $DryRun"
Write-Host "   AUDIT_ONLY_BAD    = $OnlyBad"
Write-Host "   AUDIT_MAX_TOKENS  = $MaxTokens"
Write-Host ""
Write-Host " Final flags: $($flags -join ' ')"
Write-Host ""
Write-Host " Press Ctrl+C within 3 seconds to cancel..."
Start-Sleep -Seconds 3
Write-Host ""

# Run
$scriptPath = Join-Path (Join-Path $serverDir "scripts") "audit-and-fix-products.js"
Write-Host "Running: node $scriptPath $($flags -join ' ')"
Write-Host ""

try {
    & node $scriptPath @flags
    $rc = $LASTEXITCODE
} catch {
    $rc = 1
    Write-Host "[ERROR] Failed to run script: $_"
}

Write-Host ""
if ($rc -ne 0) {
    Write-Host "[ERROR] audit-and-fix-products.js exited with code $rc"
} else {
    Write-Host "[OK] Finished cleanly."
}
Write-Host ""

# Return to original directory
Pop-Location

if ($rc -ne 0) {
    exit $rc
}