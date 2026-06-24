#Requires -Version 5.1
<#
.SYNOPSIS
    Scan product image URLs and delete products whose images are ALL broken (HTTP 404/410).
.DESCRIPTION
    Checks each DISTINCT image url only once (products often share urls), finds products
    whose every image returns 404/410, and deletes them. Dry run by default.
.PARAMETER Apply
    Actually delete. Without this it's a dry run (reports only). Default: $false
.PARAMETER Concurrency
    Parallel url checks. Default: 20
.PARAMETER IncludeOrdered
    Also delete products that have order history (otherwise they are skipped). Default: $false
.PARAMETER Limit
    Only scan the first N products (for testing). 0 = all. Default: 0
.EXAMPLE
    .\run_delete_broken_images.ps1                      # dry run, scan everything
.EXAMPLE
    .\run_delete_broken_images.ps1 -Limit 2000          # dry run on a subset
.EXAMPLE
    .\run_delete_broken_images.ps1 -Apply               # delete (skips ordered products)
.EXAMPLE
    .\run_delete_broken_images.ps1 -Apply -Concurrency 40
#>
param(
    [switch]$Apply,
    [int]$Concurrency = 20,
    [switch]$IncludeOrdered,
    [int]$Limit = 0
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:NODE_ENV = "development"
$env:DATABASE_URL = "postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway?sslmode=require&connection_limit=3&pool_timeout=20&connect_timeout=120&keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=3"

$scriptPath = Join-Path $PSScriptRoot "server\scripts\delete-broken-image-products.js"

$flags = @("--concurrency=$Concurrency")
if ($Apply) { $flags += "--apply" }
if ($IncludeOrdered) { $flags += "--include-ordered" }
if ($Limit -gt 0) { $flags += "--limit=$Limit" }

Write-Host "Running: node $scriptPath $($flags -join ' ')" -ForegroundColor Cyan
& node $scriptPath @flags
