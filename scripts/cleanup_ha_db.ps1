# Safe HA Database Cleanup Script
# Xóa home-assistant_v2.db an toàn để giảm dung lượng
# Devices và integrations sẽ được GIỮ NGUYÊN (lưu trong .storage/)

Write-Host "=== HA Database Cleanup ===" -ForegroundColor Cyan
Write-Host ""

$dbPath = "C:\homeassistant\config\home-assistant_v2.db"
$dbShm = "C:\homeassistant\config\home-assistant_v2.db-shm"
$dbWal = "C:\homeassistant\config\home-assistant_v2.db-wal"

# Step 1: Check current size
if (Test-Path $dbPath) {
    $sizeBefore = [math]::Round((Get-Item $dbPath).Length / 1GB, 2)
    Write-Host "[1/4] Current DB size: $sizeBefore GB" -ForegroundColor Yellow
}
else {
    Write-Host "Database not found at $dbPath" -ForegroundColor Red
    exit 1
}

# Step 2: Verify .storage exists (contains device configs)
$storagePath = "C:\homeassistant\config\.storage"
if (Test-Path $storagePath) {
    $storageFiles = (Get-ChildItem $storagePath -File).Count
    Write-Host "[2/4] .storage folder verified: $storageFiles config files (DEVICES SAFE)" -ForegroundColor Green
}
else {
    Write-Host ".storage folder not found! Aborting." -ForegroundColor Red
    exit 1
}

# Step 3: Stop Home Assistant
Write-Host "[3/4] Stopping Home Assistant..." -ForegroundColor Yellow
Write-Host "   Please stop HA manually if running, then press Enter to continue..."
Read-Host

# Step 4: Delete database files
Write-Host "[4/4] Deleting database files..." -ForegroundColor Yellow

try {
    if (Test-Path $dbPath) {
        Remove-Item $dbPath -Force
        Write-Host "   Deleted: home-assistant_v2.db" -ForegroundColor Green
    }
    if (Test-Path $dbShm) {
        Remove-Item $dbShm -Force
        Write-Host "   Deleted: home-assistant_v2.db-shm" -ForegroundColor Green
    }
    if (Test-Path $dbWal) {
        Remove-Item $dbWal -Force
        Write-Host "   Deleted: home-assistant_v2.db-wal" -ForegroundColor Green
    }
}
catch {
    Write-Host "Error deleting: $_" -ForegroundColor Red
    Write-Host "Make sure HA is completely stopped!" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Cyan
Write-Host "Freed: ~$sizeBefore GB" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Start Home Assistant"
Write-Host "2. A new empty database will be created (~100 MB)"
Write-Host "3. All devices and integrations remain intact"
Write-Host ""
Write-Host "Optional: Add to configuration.yaml to keep DB small:" -ForegroundColor DarkGray
Write-Host "  recorder:" -ForegroundColor DarkGray
Write-Host "    purge_keep_days: 1" -ForegroundColor DarkGray
