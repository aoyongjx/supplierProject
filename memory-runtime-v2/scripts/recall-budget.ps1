param(
  [Parameter(Mandatory=$true)][string]$InputJson,
  [int]$TopK = 5,
  [int]$BudgetBytes = 12000
)

$ErrorActionPreference='Stop'

if (-not $InputJson.Trim()) { '[]'; exit 0 }
$items = $InputJson | ConvertFrom-Json
if ($items -isnot [System.Collections.IEnumerable]) { $items = @($items) }

$selected = @()
$used = 0
$count = 0
foreach ($it in $items) {
  if ($count -ge $TopK) { break }
  $summary = [string]$it.summary
  $size = [Text.Encoding]::UTF8.GetByteCount($summary)
  if (($used + $size) -gt $BudgetBytes) { continue }
  $selected += $it
  $used += $size
  $count += 1
}

$selected | ConvertTo-Json -Depth 6
