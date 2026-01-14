# Sync Device History to Cloudflare KV via Worker API
# Run this after fetching historical data

param(
    [string]$WorkerUrl = "https://temperature-soc-power.applike098.workers.dev",
    [string]$Secret = "lumentree123",
    [string]$HistoryFile = "C:\Users\Admin\Downloads\lightearth web\device_history_Ha_2025.json"
)

Write-Host "=== Sync History to Cloudflare KV ===" -ForegroundColor Cyan

if (-not (Test-Path $HistoryFile)) {
    Write-Error "History file not found: $HistoryFile"
    exit 1
}

Write-Host "Reading $HistoryFile..." -ForegroundColor Gray
$history = Get-Content $HistoryFile -Raw | ConvertFrom-Json

$apiUrl = "$WorkerUrl/api/admin/sync-history?secret=$Secret"

Write-Host "Pushing to $WorkerUrl..." -ForegroundColor Yellow

try {
    $body = $history | ConvertTo-Json -Depth 10 -Compress
    $response = Invoke-RestMethod -Uri $apiUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 60
    
    if ($response.success) {
        Write-Host "SUCCESS: $($response.message)" -ForegroundColor Green
    }
    else {
        Write-Host "FAILED: $($response.error)" -ForegroundColor Red
    }
}
catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    exit 1
}

Write-Host "Done!" -ForegroundColor Cyan
