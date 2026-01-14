# Sync Lumentree Tokens + Auto-fetch 2025 data for devices missing history
# Runs every 5 minutes via Task Scheduler
# v3.0 - Detects devices missing history (not just new tokens)

param(
    [string]$WorkerUrl = "https://temperature-soc-power.applike098.workers.dev",
    [string]$HaConfigPath = "C:\homeassistant\config",
    [string]$SecretKey = "lumentree123"
)

Write-Host "=== Lumentree Auto Sync v3.0 ===" -ForegroundColor Cyan
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# Step 1: Get current tokens from KV
Write-Host "`n[1/5] Getting existing tokens from KV..." -ForegroundColor Gray
$existingTokens = @{}
try {
    $kvResponse = Invoke-RestMethod -Uri "$WorkerUrl/api/admin/tokens?secret=$SecretKey" -TimeoutSec 15
    if ($kvResponse.success -and $kvResponse.tokens) {
        $existingTokens = $kvResponse.tokens
        Write-Host "   Found $($kvResponse.count) tokens in KV" -ForegroundColor DarkGray
    }
}
catch {
    Write-Host "   KV not reachable, will sync all tokens" -ForegroundColor Yellow
}

# Step 2: Read HA config for current tokens
Write-Host "[2/5] Reading HA config..." -ForegroundColor Gray
$configFile = "$HaConfigPath\.storage\core.config_entries"
if (-not (Test-Path $configFile)) {
    Write-Host "   ERROR: Config file not found!" -ForegroundColor Red
    exit 1
}

$reader = [System.IO.StreamReader]::new($configFile)
$content = $reader.ReadToEnd()
$reader.Close()
$config = $content | ConvertFrom-Json

$haTokens = @{}

foreach ($entry in $config.data.entries) {
    if ($entry.domain -eq "lumentree" -and $entry.data.device_id -and $entry.data.http_token) {
        $deviceId = $entry.data.device_id.ToUpper()
        $token = $entry.data.http_token.ToUpper()
        $haTokens[$deviceId] = $token
    }
}

Write-Host "   HA has $($haTokens.Count) devices" -ForegroundColor DarkGray

# Step 3: Sync all tokens to KV
Write-Host "[3/5] Syncing tokens to KV..." -ForegroundColor Gray
$body = @{ tokens = $haTokens } | ConvertTo-Json -Depth 5
try {
    $response = Invoke-RestMethod -Uri "$WorkerUrl/api/admin/sync-tokens?secret=$SecretKey" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30
    if ($response.success) {
        Write-Host "   Synced $($haTokens.Count) tokens" -ForegroundColor Green
    }
}
catch {
    Write-Host "   ERROR syncing tokens: $_" -ForegroundColor Red
}

# Step 4: Check for devices missing 2025 history
Write-Host "[4/5] Checking 2025 history..." -ForegroundColor Gray
$kvHistory = $null
$devicesToFetch = @()

try {
    $historyRes = Invoke-RestMethod -Uri "$WorkerUrl/api/admin/history/2025?secret=$SecretKey" -TimeoutSec 15
    if ($historyRes.success) {
        $kvHistory = $historyRes.data
        Write-Host "   History has $($kvHistory.deviceCount) devices" -ForegroundColor DarkGray
        
        # Find devices with tokens but no history
        foreach ($deviceId in $haTokens.Keys) {
            $found = $false
            try {
                if ($kvHistory.devices.PSObject.Properties | Where-Object { $_.Name -eq $deviceId }) {
                    $found = $true
                }
            }
            catch {}
            
            if (-not $found) {
                $devicesToFetch += @{ deviceId = $deviceId; token = $haTokens[$deviceId] }
            }
        }
    }
}
catch {
    Write-Host "   Could not check history" -ForegroundColor Yellow
}

if (-not $kvHistory) {
    $kvHistory = @{ year = 2025; devices = @{} }
}

# Step 5: Fetch 2025 data for missing devices
if ($devicesToFetch.Count -gt 0) {
    Write-Host "[5/5] Fetching 2025 data for $($devicesToFetch.Count) device(s) missing history..." -ForegroundColor Yellow
    
    foreach ($device in $devicesToFetch) {
        $deviceId = $device.deviceId
        $token = $device.token
        Write-Host "   Fetching $deviceId..." -NoNewline
        
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
        
        # Add to history
        $kvHistory.devices | Add-Member -NotePropertyName $deviceId -NotePropertyValue $deviceData -Force
        Write-Host " PV:$($deviceData.pv) Grid:$($deviceData.grid) Load:$($deviceData.load)" -ForegroundColor Green
    }
    
    # Upload updated history to KV
    Write-Host "   Uploading updated history..." -NoNewline
    $kvHistory.fetchedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
    $kvHistory.deviceCount = $kvHistory.devices.PSObject.Properties.Count
    $histBody = $kvHistory | ConvertTo-Json -Depth 10 -Compress
    
    try {
        $uploadRes = Invoke-RestMethod -Uri "$WorkerUrl/api/admin/sync-history?secret=$SecretKey" -Method POST -Body $histBody -ContentType "application/json" -TimeoutSec 60
        if ($uploadRes.success) {
            Write-Host " Done!" -ForegroundColor Green
        }
    }
    catch {
        Write-Host " Failed: $_" -ForegroundColor Red
    }
}
else {
    Write-Host "[5/5] All devices have 2025 history" -ForegroundColor DarkGray
}

Write-Host "`n=== Sync Complete ===" -ForegroundColor Cyan
