# Remove Lumentree Device from Home Assistant
# Device ID: P250927375
# IMPORTANT: Stop Home Assistant before running this script!

param(
    [string]$HaConfigPath = "C:\homeassistant\config",
    [string[]]$DevicesToRemove = @("P250927375")
)

Write-Host "=== Remove Lumentree Devices from HA ===" -ForegroundColor Cyan
Write-Host "Devices to remove: $($DevicesToRemove -join ', ')" -ForegroundColor Yellow
Write-Host ""

# Step 1: Backup config
$configFile = "$HaConfigPath\.storage\core.config_entries"
$backupFile = "$HaConfigPath\.storage\core.config_entries.backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"

if (-not (Test-Path $configFile)) {
    Write-Host "ERROR: Config file not found: $configFile" -ForegroundColor Red
    exit 1
}

Write-Host "[1/4] Backing up config..." -NoNewline
Copy-Item $configFile $backupFile
Write-Host " Done ($backupFile)" -ForegroundColor Green

# Step 2: Read and parse config
Write-Host "[2/4] Reading config..." -NoNewline
$reader = [System.IO.StreamReader]::new($configFile)
$content = $reader.ReadToEnd()
$reader.Close()
$config = $content | ConvertFrom-Json
$originalCount = ($config.data.entries | Where-Object { $_.domain -eq "lumentree" }).Count
Write-Host " Found $originalCount Lumentree devices" -ForegroundColor Green

# Step 3: Filter out devices to remove
Write-Host "[3/4] Removing devices..." -NoNewline
$removedDevices = @()

$config.data.entries = $config.data.entries | Where-Object {
    if ($_.domain -eq "lumentree" -and $_.data.device_id -in $DevicesToRemove) {
        $removedDevices += $_.data.device_id
        return $false  # Remove this entry
    }
    return $true  # Keep this entry
}

$newCount = ($config.data.entries | Where-Object { $_.domain -eq "lumentree" }).Count
Write-Host " Removed $($removedDevices.Count) device(s)" -ForegroundColor Green

if ($removedDevices.Count -gt 0) {
    Write-Host "   Removed: $($removedDevices -join ', ')" -ForegroundColor Yellow
}

# Step 4: Save config
Write-Host "[4/4] Saving config..." -NoNewline
$config | ConvertTo-Json -Depth 20 -Compress | Set-Content $configFile -Encoding UTF8
Write-Host " Done" -ForegroundColor Green

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Before: $originalCount Lumentree devices"
Write-Host "After:  $newCount Lumentree devices"
Write-Host "Removed: $($removedDevices.Count) device(s)"
Write-Host ""

# Optional: Remove device cache
$cacheRemoved = 0
foreach ($deviceId in $removedDevices) {
    $cachePath = "$HaConfigPath\custom_components\lumentree\cache\$deviceId"
    if (Test-Path $cachePath) {
        Write-Host "Removing cache for $deviceId..." -NoNewline
        Remove-Item $cachePath -Recurse -Force
        Write-Host " Done" -ForegroundColor Green
        $cacheRemoved++
    }
}

Write-Host ""
Write-Host "IMPORTANT: Restart Home Assistant for changes to take effect!" -ForegroundColor Yellow
Write-Host "Backup saved to: $backupFile" -ForegroundColor DarkGray
