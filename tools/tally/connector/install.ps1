# ScalePods Tally connector - install (run once, on the Tally PC, as the Windows user who keeps Tally open).
# It creates two scheduled tasks that run tally-connector.ps1 as this user. It installs no software and changes nothing in Tally.
#     powershell -ExecutionPolicy Bypass -File "E:\ScalePods\install.ps1"
# Remove again with uninstall.ps1 (or delete the two tasks in Task Scheduler).
param(
    [string]$Folder = $PSScriptRoot,
    [string]$NightlyAt = "02:00",
    [int]$CheckEveryMinutes = 5,
    [string]$TaskPrefix = "ScalePods Tally",
    [switch]$SkipTest
)
$ErrorActionPreference = "Stop"
$script = Join-Path $Folder "tally-connector.ps1"
$config = Join-Path $Folder "config.json"
if (-not (Test-Path $script)) { throw "tally-connector.ps1 is not in $Folder" }
if (-not (Test-Path $config)) { throw "config.json is not in $Folder. Copy it there first." }
$cfg = Get-Content -Raw $config | ConvertFrom-Json
if (-not $cfg.connectorKey -or $cfg.connectorKey -like "PASTE*") { throw "config.json has no connector key yet." }

Write-Host "Folder:  $Folder"
Write-Host "Tally:   $($cfg.tallyUrl)"
Write-Host "User:    $env:USERDOMAIN\$env:USERNAME (the tasks run only while this user is logged in or disconnected, never logged off)"

if (-not $SkipTest) {
    Write-Host "`nTest: telling ScalePods this PC is alive and asking Tally for its company list..."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Mode Check -Config $config
    if ($LASTEXITCODE -ne 0) { throw "The test failed (see the lines above). The tasks were NOT created." }
}

$args1 = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Mode Sync"
$args2 = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Mode Check"
$who = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $who -LogonType Interactive -RunLevel Limited

$nightly = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $args1 -WorkingDirectory $Folder
$t1 = New-ScheduledTaskTrigger -Daily -At $NightlyAt
$s1 = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 4)
Register-ScheduledTask -TaskName "$TaskPrefix nightly" -Action $nightly -Trigger $t1 -Settings $s1 -Principal $principal -Description "ScalePods: read Tally (read-only) and send it to ScalePods every night." -Force | Out-Null

$check = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $args2 -WorkingDirectory $Folder
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $CheckEveryMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$s2 = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 4)
Register-ScheduledTask -TaskName "$TaskPrefix check" -Action $check -Trigger $t2 -Settings $s2 -Principal $principal -Description "ScalePods: tell ScalePods this PC is alive and run a sync when someone presses Sync now." -Force | Out-Null

Write-Host "`nInstalled:"
Get-ScheduledTask -TaskName "$TaskPrefix*" | Select-Object TaskName, State | Format-Table -AutoSize
Write-Host "The nightly sync runs at $NightlyAt; the check runs every $CheckEveryMinutes minutes. Logs: $Folder\logs"
Write-Host "Keep Tally open with the company loaded, and DISCONNECT the remote session instead of signing out."
