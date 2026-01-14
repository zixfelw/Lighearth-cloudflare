# Remove Lumentree Device via HA API (Fixed - reads from local config)
# Device ID: P250927375

param(
    [string]$HaUrl = "http://localhost:8123",
    [string]$HaToken = "",
    [string]$HaConfigPath = "C:\homeassistant\config",
    [string[]]$DevicesToRemove = @("P250927375")
)

Write-Host "=== Remove Lumentree Device via HA API ===" -ForegroundColor Cyan
Write-Host "Devices to remove: $($DevicesToRemove -join ', ')" -ForegroundColor Yellow
Write-Host ""

if (-not $HaToken) {
    Write-Host "ERROR: Please provide HA token with -HaToken parameter" -ForegroundColor Red
    exit 1
}

# Step 1: Read local config to get entry_id for each device
Write-Host "[1/2] Reading local config to find entry IDs..." -NoNewline
$configFile = "$HaConfigPath\.storage\core.config_entries"

$reader = [System.IO.StreamReader]::new($configFile)
$content = $reader.ReadToEnd()
$reader.Close()
$config = $content | ConvertFrom-Json

$entriesToRemove = @()
foreach ($entry in $config.data.entries) {
    if ($entry.domain -eq "lumentree" -and $entry.data.device_id -in $DevicesToRemove) {
        $entriesToRemove += @{
            entry_id  = $entry.entry_id
            device_id = $entry.data.device_id
            title     = $entry.title
        }
    }
}

if ($entriesToRemove.Count -eq 0) {
    Write-Host ""
    Write-Host "No matching devices found!" -ForegroundColor Red
    exit 1
}

Write-Host " Found $($entriesToRemove.Count) device(s)" -ForegroundColor Green
foreach ($e in $entriesToRemove) {
    Write-Host "   - $($e.device_id) ($($e.title)) -> entry_id: $($e.entry_id)" -ForegroundColor Yellow
}

# Step 2: Delete via HA API
Write-Host "[2/2] Removing via HA API..." -ForegroundColor Yellow
$headers = @{
    "Authorization" = "Bearer $HaToken"
    "Content-Type"  = "application/json"
}

$removed = 0
foreach ($e in $entriesToRemove) {
    Write-Host "   Removing $($e.device_id)..." -NoNewline
    try {
        $result = Invoke-RestMethod -Uri "$HaUrl/api/config/config_entries/entry/$($e.entry_id)" -Method DELETE -Headers $headers -TimeoutSec 30
        Write-Host " Done" -ForegroundColor Green
        $removed++
    }
    catch {
        Write-Host " ERROR: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Removed: $removed device(s)" -ForegroundColor Green
Write-Host "No restart required!" -ForegroundColor Green
