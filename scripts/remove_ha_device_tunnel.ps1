# Remove Lumentree Device via HA API (Cloudflare Tunnel Version)
# v2.0 - Uses entity pattern matching like full-device-v5.0.js
# Usage: .\remove_ha_device_tunnel.ps1 -TunnelUrl "https://xxx.trycloudflare.com" -HaToken "YOUR_TOKEN" -DevicesToRemove @("H250522033")

param(
    [Parameter(Mandatory = $true)]
    [string]$TunnelUrl,
    
    [Parameter(Mandatory = $true)]
    [string]$HaToken,
    
    [string[]]$DevicesToRemove = @("H250522033")
)

Write-Host "=== Remove Lumentree Device via Cloudflare Tunnel v2.0 ===" -ForegroundColor Cyan
Write-Host "Tunnel: $TunnelUrl" -ForegroundColor DarkGray
Write-Host "Devices to remove: $($DevicesToRemove -join ', ')" -ForegroundColor Yellow
Write-Host ""

$headers = @{
    "Authorization" = "Bearer $HaToken"
    "Content-Type"  = "application/json"
}

# Step 1: Verify device exists by checking sensor entities (like full-device-v5.0.js)
Write-Host "[1/4] Verifying devices exist in HA..." -NoNewline
try {
    $states = Invoke-RestMethod -Uri "$TunnelUrl/api/states" -Headers $headers -TimeoutSec 120
    Write-Host " Got $($states.Count) entities" -ForegroundColor Green
}
catch {
    Write-Host " ERROR: $_" -ForegroundColor Red
    exit 1
}

# Extract device IDs from entity_id pattern: sensor.device_{deviceId}_*
$devicePattern = "^sensor\.device_([a-z0-9]+)_"
$foundDeviceIds = @{}

foreach ($state in $states) {
    if ($state.entity_id -match $devicePattern) {
        $deviceId = $matches[1].ToUpper()
        if (-not $foundDeviceIds.ContainsKey($deviceId)) {
            $sensorCount = ($states | Where-Object { $_.entity_id -like "sensor.device_$($deviceId.ToLower())_*" }).Count
            $foundDeviceIds[$deviceId] = $sensorCount
        }
    }
}

Write-Host "   Found $($foundDeviceIds.Count) Lumentree devices in HA:" -ForegroundColor Yellow
foreach ($dev in $foundDeviceIds.GetEnumerator() | Sort-Object Name) {
    $isTarget = if ($dev.Name -in $DevicesToRemove) { " <-- TARGET" } else { "" }
    Write-Host "      - $($dev.Name) ($($dev.Value) sensors)$isTarget" -ForegroundColor $(if ($isTarget) { "Red" } else { "DarkGray" })
}

# Verify target devices exist
$missingDevices = $DevicesToRemove | Where-Object { $_ -notin $foundDeviceIds.Keys }
if ($missingDevices.Count -gt 0) {
    Write-Host ""
    Write-Host "WARNING: These devices not found in entities: $($missingDevices -join ', ')" -ForegroundColor Yellow
    Write-Host "Will still try to find in config entries..." -ForegroundColor Yellow
}

# Step 2: Get all config entries
Write-Host "[2/4] Fetching config entries..." -NoNewline
try {
    $entries = Invoke-RestMethod -Uri "$TunnelUrl/api/config/config_entries/entry" -Headers $headers -TimeoutSec 120
    $lumentreeEntries = $entries | Where-Object { $_.domain -eq "lumentree" }
    Write-Host " Found $($lumentreeEntries.Count) Lumentree entries" -ForegroundColor Green
}
catch {
    Write-Host " ERROR: $_" -ForegroundColor Red
    exit 1
}

# Step 3: Find matching entries to remove
Write-Host "[3/4] Finding entries to remove..." -ForegroundColor Yellow
$entriesToRemove = @()

foreach ($entry in $lumentreeEntries) {
    # Check device_id in data (the main identifier used by Lumentree integration)
    $entryDeviceId = $entry.data.device_id
    $entryDeviceSn = $entry.data.device_sn  # Some entries use device_sn
    $title = $entry.title
    
    Write-Host "   Checking: $title (device_id: $entryDeviceId, device_sn: $entryDeviceSn)" -ForegroundColor DarkGray
    
    foreach ($targetDevice in $DevicesToRemove) {
        $targetUpper = $targetDevice.ToUpper()
        $targetLower = $targetDevice.ToLower()
        
        # Match by: device_id, device_sn, or title
        $isMatch = (
            ($entryDeviceId -eq $targetDevice) -or
            ($entryDeviceId -eq $targetUpper) -or
            ($entryDeviceId -eq $targetLower) -or
            ($entryDeviceSn -eq $targetDevice) -or
            ($entryDeviceSn -eq $targetUpper) -or
            ($entryDeviceSn -eq $targetLower) -or
            ($title -like "*$targetDevice*")
        )
        
        if ($isMatch) {
            $entriesToRemove += @{
                entry_id  = $entry.entry_id
                device_id = if ($entryDeviceId) { $entryDeviceId } else { $entryDeviceSn }
                title     = $title
            }
            Write-Host "   >>> MATCHED: $title (entry_id: $($entry.entry_id))" -ForegroundColor Green
        }
    }
}

if ($entriesToRemove.Count -eq 0) {
    Write-Host ""
    Write-Host "No matching entries found to remove!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Available Lumentree config entries:" -ForegroundColor Yellow
    foreach ($entry in $lumentreeEntries) {
        Write-Host "   - $($entry.title) | device_id: $($entry.data.device_id) | device_sn: $($entry.data.device_sn) | entry_id: $($entry.entry_id)" -ForegroundColor DarkGray
    }
    exit 1
}

Write-Host "   Total: $($entriesToRemove.Count) entry(s) to remove" -ForegroundColor Green

# Step 4: Delete via HA API
Write-Host "[4/4] Removing entries via API..." -ForegroundColor Yellow
$removed = 0
$failed = 0

foreach ($e in $entriesToRemove) {
    Write-Host "   Removing $($e.title) (entry_id: $($e.entry_id))..." -NoNewline
    try {
        $result = Invoke-RestMethod -Uri "$TunnelUrl/api/config/config_entries/entry/$($e.entry_id)" -Method DELETE -Headers $headers -TimeoutSec 60
        Write-Host " DONE" -ForegroundColor Green
        $removed++
    }
    catch {
        Write-Host " ERROR: $_" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Successfully removed: $removed device(s)" -ForegroundColor Green
if ($failed -gt 0) {
    Write-Host "Failed: $failed device(s)" -ForegroundColor Red
}
Write-Host "No restart required - changes take effect immediately!" -ForegroundColor Green
