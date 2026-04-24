param(
  [switch]$ApplyMerge
)

$ErrorActionPreference='Stop'
$mergeScript = Join-Path $PSScriptRoot 'memory-merge.ps1'

Write-Output '[maintenance] running merge dry-run...'
& $mergeScript

if ($ApplyMerge) {
  Write-Output '[maintenance] applying merge...'
  & $mergeScript -Apply
}

Write-Output '[maintenance] done'
