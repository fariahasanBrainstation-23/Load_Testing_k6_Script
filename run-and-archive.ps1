<#
.SYNOPSIS
  Runs a k6 test script, generates its Excel report, and archives every artifact
  (HTML report, Excel report, summary files, run log) into a timestamped folder
  under reports/archive/<script-name>/, plus appends an entry to that script's
  run-history.txt with the exact command used.

  The "latest" copies in reports/ (e.g. reports/online_recharge-report.html) are
  left in place, untouched -- this only adds timestamped copies alongside them.

.EXAMPLE
  .\run-and-archive.ps1 selfcare/online_recharge_test.js -e VUS=5 -e REPEAT=2 -e AMOUNT=300

.EXAMPLE
  .\run-and-archive.ps1 bulk_purchase_changeplan_test.js -e VUS=1 -e ITERATIONS_PER_VU=1
#>

$ErrorActionPreference = 'Stop'

if ($args.Count -lt 1) {
  Write-Error "Usage: .\run-and-archive.ps1 <script-path> [-e KEY=VALUE ...]"
  exit 1
}

$ScriptPath = $args[0]
$K6Args = @()
if ($args.Count -gt 1) {
  $K6Args = $args[1..($args.Count - 1)]
}

# Derive the report-file base name from the script's filename, e.g.
# selfcare/online_recharge_test.js -> online_recharge
# bulk_purchase_changeplan_test.js -> bulk_purchase_changeplan
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($ScriptPath) -replace '_test$', ''

$runLog = "reports/$baseName-run.log"
$xlsxOut = "reports/${baseName}_report.xlsx"

Remove-Item $runLog -ErrorAction SilentlyContinue

$displayCommand = "k6 run $($K6Args -join ' ') --console-output $runLog $ScriptPath"
Write-Host "Running: $displayCommand"

& k6 run @K6Args --console-output $runLog $ScriptPath
if ($LASTEXITCODE -ne 0) {
  Write-Warning "k6 exited with code $LASTEXITCODE -- continuing to generate/archive whatever ran."
}

node generate-excel-report.js $runLog $xlsxOut

$timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$archiveDir = "reports/archive/$baseName/$timestamp"
New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null

Get-ChildItem "reports" -Filter "$baseName-*" -File -ErrorAction SilentlyContinue |
  Copy-Item -Destination $archiveDir -Force
Get-ChildItem "reports" -Filter "${baseName}_*" -File -ErrorAction SilentlyContinue |
  Copy-Item -Destination $archiveDir -Force

$historyFile = "reports/archive/$baseName/run-history.txt"
$logLine = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $displayCommand"
Add-Content -Path $historyFile -Value $logLine

Write-Host "Archived to: $archiveDir"
Write-Host "History log: $historyFile"
