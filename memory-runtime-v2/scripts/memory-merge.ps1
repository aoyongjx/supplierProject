param(
  [string]$ConfigPath,
  [switch]$Apply
)

$ErrorActionPreference='Stop'
if (-not $ConfigPath) {
  $ConfigPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'config\memory.config.json'
}

function Normalize-Text([string]$s) {
  if (-not $s) { return '' }
  return ($s.ToLowerInvariant() -replace '[^\p{L}\p{Nd}\s_-]', ' ' -replace '\s+', ' ').Trim()
}

function Token-Set([string]$s) {
  $n = Normalize-Text $s
  $arr = $n.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries) | Where-Object { $_.Length -gt 1 } | Select-Object -Unique
  return @($arr)
}

function Jaccard([string]$a, [string]$b) {
  $A = New-Object 'System.Collections.Generic.HashSet[string]' ([string[]](Token-Set $a))
  $B = New-Object 'System.Collections.Generic.HashSet[string]' ([string[]](Token-Set $b))
  if ($A.Count -eq 0 -or $B.Count -eq 0) { return 0.0 }
  $inter=0
  foreach ($x in $A) { if ($B.Contains($x)) { $inter++ } }
  $union = $A.Count + $B.Count - $inter
  if ($union -le 0) { return 0.0 }
  return [double]$inter / [double]$union
}

$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$indexPath = $config.storage.index_file
if (-not (Test-Path $indexPath)) { '[]'; exit 0 }

$rows = @()
Get-Content $indexPath | ForEach-Object {
  if (-not $_.Trim()) { return }
  try { $rows += ($_ | ConvertFrom-Json) } catch {}
}

$threshold = [double]$config.merge.similarity_threshold
$groups = @{}
foreach ($r in $rows) {
  $k = "$($r.type)::" + (Normalize-Text $r.title)
  if (-not $groups.ContainsKey($k)) { $groups[$k] = @() }
  $groups[$k] += $r
}

$mergePlan = @()
foreach ($k in $groups.Keys) {
  $items = $groups[$k] | Sort-Object -Property updated_at -Descending
  if ($items.Count -lt 2) { continue }

  $head = $items[0]
  $toMerge = @()
  for ($i=1; $i -lt $items.Count; $i++) {
    $sim = Jaccard -a $head.summary -b $items[$i].summary
    if ($sim -ge $threshold) {
      $toMerge += [pscustomobject]@{ item=$items[$i]; similarity=[Math]::Round($sim,3) }
    }
  }
  if ($toMerge.Count -gt 0) {
    $mergePlan += [pscustomobject]@{ key=$k; head=$head; merged=$toMerge }
  }
}

if (-not $Apply) {
  $mergePlan | ConvertTo-Json -Depth 8
  exit 0
}

foreach ($plan in $mergePlan) {
  $head = $plan.head
  $mergedItems = $plan.merged | ForEach-Object { $_.item }
  $allTags = @($head.tags + ($mergedItems | ForEach-Object { $_.tags } | ForEach-Object { $_ })) | Where-Object { $_ } | Select-Object -Unique
  $allSummaries = @($head.summary) + ($mergedItems | ForEach-Object { $_.summary })
  $newSummary = ($allSummaries | Select-Object -Unique) -join "`n---`n"

  $saveScript = Join-Path $PSScriptRoot 'save-memory.ps1'
  & $saveScript `
    -Type $head.type `
    -Title $head.title `
    -Summary $newSummary `
    -Layer 'L3_semantic' `
    -Source 'merge' `
    -Tags @($allTags + 'merged') | Out-Null
}

# prune exact duplicated keys by keeping latest (save-memory already does key upsert)
'merged'
