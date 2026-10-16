<#
.SYNOPSIS
  Runs a k6 test script, generates its Excel report, and keeps every result of that run
  (HTML report, Excel report, summary files, run log) in ONE place only:
  reports/archive/<script-name>/<timestamp>/

  Nothing is left behind in reports/, so there are no duplicate copies. The run log and the
  Excel report are written straight into the archive folder; the files the k6 script itself
  writes into reports/ (HTML report, summary files) are moved into it once the run ends.
  Only files modified during this run are moved, so an old leftover file can never end up
  in a new archive. A one-line entry with the command is appended to run-history.txt.

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

# PowerShell turns an unquoted value that contains commas (e.g. -e LEDGER_MIX=A:1,B:2) into an array, which would
# reach k6 as two separate arguments. Join such pieces back into the single string that was typed.
$argList = @($args | ForEach-Object { if ($_ -is [array]) { $_ -join ',' } else { "$_" } })

$ScriptPath = $argList[0]
$K6Args = @()
if ($argList.Count -gt 1) {
  $K6Args = $argList[1..($argList.Count - 1)]
}

# Derive the report-file base name from the script's filename, e.g.
# selfcare/online_recharge_test.js -> online_recharge
# bulk_purchase_changeplan_test.js -> bulk_purchase_changeplan
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($ScriptPath) -replace '_test$', ''

$runStart = Get-Date
$stamp = $runStart.ToString('yyyy-MM-dd_HH-mm-ss')
$archiveRoot = "reports/archive/$baseName"
$archiveDir = "$archiveRoot/$stamp"
New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null

$runLog = "$archiveDir/$baseName-run.log"
$xlsxOut = "$archiveDir/${baseName}_report.xlsx"

$displayCommand = "k6 run $($K6Args -join ' ') $ScriptPath"
Write-Host "Running: $displayCommand"

& k6 run @K6Args --console-output $runLog $ScriptPath
if ($LASTEXITCODE -ne 0) {
  Write-Warning "k6 exited with code $LASTEXITCODE -- continuing to generate/archive whatever ran."
}

if (Test-Path $runLog) {
  node generate-excel-report.js $runLog $xlsxOut
}

# Move the files the k6 script wrote into reports/ during this run (2s margin for file-time rounding).
# summary.json / summary.txt have no script name in them, so they are matched by time alone.
$since = $runStart.AddSeconds(-2)
$genericNames = @('summary.json', 'summary.txt')
$files = @(Get-ChildItem 'reports' -File -ErrorAction SilentlyContinue | Where-Object {
    $_.LastWriteTime -ge $since -and (
      $_.Name -like "$baseName-*" -or $_.Name -like "${baseName}_*" -or ($genericNames -contains $_.Name))
  })

$moved = @()
foreach ($file in $files) {
  # The in-memory request log is always empty (k6 runs the summary in a separate context), so don't keep it.
  if ($file.Name -like '*-log.json' -and $file.Length -le 10) {
    Remove-Item $file.FullName -Force
  } else {
    Move-Item $file.FullName -Destination $archiveDir -Force
    $moved += $file.Name
  }
}

$historyFile = "$archiveRoot/run-history.txt"
Add-Content -Path $historyFile -Value "$($runStart.ToString('yyyy-MM-dd HH:mm:ss')) | $displayCommand"

Write-Host "Archived to: $archiveDir"
Write-Host "  Moved from reports/: $($moved -join ', ')"
Write-Host "History log: $historyFile"
