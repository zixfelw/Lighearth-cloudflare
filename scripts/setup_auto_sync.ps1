# Create Windows Task Scheduler job to sync tokens every 5 minutes
# Run this script ONCE as Administrator

$taskName = "LumentreeTokenSync"
$scriptPath = "C:\Users\Admin\Downloads\lightearth web\scripts\sync_tokens_to_kv.ps1"

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Please run this script as Administrator!" -ForegroundColor Red
    exit 1
}

# Remove existing task if exists
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create action
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

# Create trigger: every 5 minutes using Daily trigger with repetition
$trigger = New-ScheduledTaskTrigger -Daily -At "00:00"
$trigger.Repetition.Interval = "PT5M"
$trigger.Repetition.Duration = "P1D"

# Create settings
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Register the task
try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Syncs Lumentree tokens every 5 minutes" -Force
    Write-Host ""
    Write-Host "SUCCESS! Task created: $taskName" -ForegroundColor Green
    Write-Host "Interval: Every 5 minutes" -ForegroundColor Cyan
    Write-Host ""
    
    # Start it now
    Start-ScheduledTask -TaskName $taskName
    Write-Host "Task started!" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
}
