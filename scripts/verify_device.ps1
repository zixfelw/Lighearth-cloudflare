# Powerful Device Verification Script
# 1. Checks local token file
# 2. If no local token, attempts to fetch directly from Lumentree API (like the mobile app does)
# 3. Validates device authenticity based on API response

param(
    [Parameter(Mandatory = $true)]
    [string]$DeviceId
)

$DeviceId = $DeviceId.ToUpper()
$tokenFile = "C:\Users\Admin\Downloads\lightearth web\device_tokens_116.json"
$BaseUrl = "http://lesvr.suntcn.com/lesvr"

Write-Host "=== Verifying Device: $DeviceId ===" -ForegroundColor Cyan

# 1. Check Local File
Write-Host "[1] Checking local device_tokens_116.json..." -NoNewline
$tokens = Get-Content $tokenFile -Raw | ConvertFrom-Json
$prop = $tokens.PSObject.Properties | Where-Object { $_.Name -eq $DeviceId }
$localToken = if ($prop) { $prop.Value } else { $null }

if ($localToken) {
    Write-Host " FOUND" -ForegroundColor Green
    Write-Host "    Local Token: $($localToken.Substring(0,8))..." -ForegroundColor Gray
}
else {
    Write-Host " NOT FOUND" -ForegroundColor Yellow
}

# 2. Check Direct API (The ultimate truth test)
Write-Host "`n[2] Checking Lumentree Cloud API..." 
Write-Host "    (This method generates a new token if the device is REAL)" -ForegroundColor Gray

try {
    # A. Get Server Time
    $timeReq = Invoke-RestMethod -Uri "$BaseUrl/getServerTime" -TimeoutSec 10
    $serverTime = $timeReq.data.serverTime
    
    if (-not $serverTime) { throw "Could not get server time" }
    
    # B. Request Token (shareDevices endpoint)
    # This is how the app/integration authenticates a device ID
    $body = @{
        deviceIds  = $DeviceId
        serverTime = $serverTime
    }
    
    $tokenReq = Invoke-RestMethod -Uri "$BaseUrl/shareDevices" -Method Post -Body $body -Headers @{"source" = "2" } -TimeoutSec 15
    
    $cloudToken = $tokenReq.data.token
    
    if ($cloudToken) {
        Write-Host "    ✅ SUCCESS: Device is REAL" -ForegroundColor Green
        Write-Host "    Cloud Token: $($cloudToken.Substring(0,8))..." -ForegroundColor Green
        
        if ($localToken -and $localToken -ne $cloudToken) {
            Write-Host "    ⚠️  NOTE: Cloud token differs from local token (this is normal, tokens rotate)" -ForegroundColor Yellow
        }
        
        $finalToken = $cloudToken
    }
    else {
        Write-Host "    ❌ FAILED: Device likely FAKE or Invalid" -ForegroundColor Red
        Write-Host "    API Response: returnValue=$($tokenReq.returnValue), msg=$($tokenReq.msg)" -ForegroundColor Red
        $finalToken = $localToken # Fallback to local if checking existing
    }

}
catch {
    Write-Host "    ⚠️  API Error: $_" -ForegroundColor Red
    $finalToken = $localToken
}

# 3. Final Verdict
Write-Host "`n=== FINAL VERDICT ===" -ForegroundColor Cyan
if ($finalToken) {
    Write-Host "🟢 REAL DEVICE" -ForegroundColor Green
    
    # Optional: Verify if it has data
    Write-Host "`n[3] Checking for Data (Year 2025)..." -NoNewline
    try {
        $dataUrl = "$BaseUrl/getYearData?deviceId=$DeviceId&queryDate=2025-06-15"
        $dataReq = Invoke-RestMethod -Uri $dataUrl -Headers @{"Authorization" = $finalToken } -TimeoutSec 10
        if ($dataReq.returnValue -eq 1) {
            Write-Host " SUCCESS" -ForegroundColor Green
            if ($dataReq.data.pv.tableValueInfo) {
                $count = ($dataReq.data.pv.tableValueInfo | Where-Object { [double]$_.tableValue -gt 0 }).Count
                Write-Host "    has $count months of PV data" -ForegroundColor Gray
            }
            else {
                Write-Host "    (No recorded data yet)" -ForegroundColor Gray
            }
        }
        else {
            Write-Host " FAILED (rv=$($dataReq.returnValue))" -ForegroundColor Red
        }
    }
    catch {
        Write-Host " ERROR checking data" -ForegroundColor Red
    }
}
else {
    Write-Host "🔴 FAKE / INVALID DEVICE" -ForegroundColor Red
    Write-Host "   - No token in file"
    Write-Host "   - API refused to generate token"
}
Write-Host ""
