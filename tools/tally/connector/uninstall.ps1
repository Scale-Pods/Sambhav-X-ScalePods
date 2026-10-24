# ScalePods Tally connector - remove the two scheduled tasks. Leaves the folder and its logs in place.
#     powershell -ExecutionPolicy Bypass -File "E:\ScalePods\uninstall.ps1"
param([string]$TaskPrefix = "ScalePods Tally")
$tasks = Get-ScheduledTask -TaskName "$TaskPrefix*" -ErrorAction SilentlyContinue
if (-not $tasks) { Write-Host "No ScalePods tasks found."; exit 0 }
foreach ($t in $tasks) { Unregister-ScheduledTask -TaskName $t.TaskName -Confirm:$false; Write-Host "Removed: $($t.TaskName)" }
Write-Host "Done. Delete the folder yourself if you also want the files gone."
