# Fetch missing 2025 data for devices that have tokens but no history
# Run once to fill in gaps

param(
    [string]$WorkerUrl = "https://temperature-soc-power.applike098.workers.dev",
    [string]$SecretKey = "lumentree123"
)

Write-Host "=== Fetch Missing 2025 History ===" -ForegroundColor Cyan

# Get all tokens
Write-Host "[1/3] Getting tokens from KV..." -NoNewline
$tokensRes = Invoke-RestMethod -Uri "$WorkerUrl/api/admin/tokens?secret=$SecretKey" -TimeoutSec 15
$tokens = $tokensRes.tokens
Write-Host " Found $($tokensRes.count) tokens" -ForegroundColor Green

# Get existing 2025 history
Write-Host "[2/3] Getting 2025 history from KV..." -NoNewline
$historyRes = Invoke-RestMethod -Uri "$WorkerUrl/api/admin/history/2025?secret=$SecretKey" -TimeoutSec 15
$history = $historyRes.data
Write-Host " Found $($history.deviceCount) devices with data" -ForegroundColor Green

# Find missing devices
$missing = @()
foreach ($prop in $tokens.PSObject.Properties) {
    $deviceId = $prop.Name
    if (-not $history.devices.PSObject.Properties[$deviceId]) {
        $missing += @{ deviceId = $deviceId; token = $prop.Value }
    }
}

Write-Host ""
Write-Host "Missing devices: $($missing.Count)" -ForegroundColor Yellow
if ($missing.Count -eq 0) {
    Write-Host "All devices have 2025 data!" -ForegroundColor Green
    exit
}

# Fetch data for missing devices
Write-Host ""
Write-Host "[3/3] Fetching 2025 data for $($missing.Count) missing devices..." -ForegroundColor Yellow

foreach ($device in $missing) {
    $deviceId = $device.deviceId
    $token = $device.token
    Write-Host "  $deviceId..." -NoNewline
    
    $deviceData = @{ grid = 0; load = 0; pv = 0; months = @{} }
    
    for ($month = 1; $month -le 12; $month++) {
        $daysInMonth = [DateTime]::DaysInMonth(2025, $month)
        $monthKey = "2025-$($month.ToString('D2'))"
        $monthGrid = 0; $monthLoad = 0; $monthPv = 0
        
        for ($day = 1; $day -le $daysInMonth; $day++) {
            $dateStr = (Get-Date -Year 2025 -Month $month -Day $day).ToString("yyyy-MM-dd")
            $h = @{"Authorization" = $token }
            
            try {
                $rOther = Invoke-RestMethod -Uri "http://lesvr.suntcn.com/lesvr/getOtherDayData?queryDate=$dateStr&deviceId=$deviceId" -Headers $h -TimeoutSec 3 -ErrorAction SilentlyContinue
                if ($rOther.returnValue -eq 1 -and $rOther.data) {
                    if ($rOther.data.grid.tableValue) { $monthGrid += [double]$rOther.data.grid.tableValue / 10.0 }
                    if ($rOther.data.homeload.tableValue) { $monthLoad += [double]$rOther.data.homeload.tableValue / 10.0 }
                }
                
                $rPv = Invoke-RestMethod -Uri "http://lesvr.suntcn.com/lesvr/getPVDayData?queryDate=$dateStr&deviceId=$deviceId" -Headers $h -TimeoutSec 3 -ErrorAction SilentlyContinue
                if ($rPv.returnValue -eq 1 -and $rPv.data.pv.tableValue) {
                    $monthPv += [double]$rPv.data.pv.tableValue / 10.0
                }
            }
            catch {}
        }
        
        if ($monthGrid -gt 0 -or $monthLoad -gt 0 -or $monthPv -gt 0) {
            $deviceData.months[$monthKey] = @{ 
                grid = [math]::Round($monthGrid, 1)
                load = [math]::Round($monthLoad, 1)
                pv   = [math]::Round($monthPv, 1)
            }
        }
        $deviceData.grid += $monthGrid
        $deviceData.load += $monthLoad
        $deviceData.pv += $monthPv
    }
    
    $deviceData.grid = [math]::Round($deviceData.grid, 1)
    $deviceData.load = [math]::Round($deviceData.load, 1)
    $deviceData.pv = [math]::Round($deviceData.pv, 1)
    
    $history.devices | Add-Member -NotePropertyName $deviceId -NotePropertyValue $deviceData -Force
    Write-Host " PV:$($deviceData.pv) Grid:$($deviceData.grid) Load:$($deviceData.load)" -ForegroundColor Green
}

# Upload updated history
Write-Host ""
Write-Host "Uploading updated history..." -NoNewline
$history.fetchedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
$history.deviceCount = $history.devices.PSObject.Properties.Count
$histBody = $history | ConvertTo-Json -Depth 10 -Compress

try {
    $uploadRes = Invoke-RestMethod -Uri "$WorkerUrl/api/admin/sync-history?secret=$SecretKey" -Method POST -Body $histBody -ContentType "application/json" -TimeoutSec 60
    if ($uploadRes.success) {
        Write-Host " Done!" -ForegroundColor Green
    }
}
catch {
    Write-Host " Failed: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Complete ===" -ForegroundColor Cyan
