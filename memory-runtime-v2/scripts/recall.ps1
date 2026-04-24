param(
  [Parameter(Mandatory=$true)][string]$Query,
  [int]$TopK = 8,
  [int]$BudgetBytes = 12000,
  [string]$ConfigPath
)

$ErrorActionPreference='Stop'
if (-not $ConfigPath) {
  $ConfigPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'config\memory.config.json'
}

function Normalize-Text([string]$s) {
  if (-not $s) { return '' }
  return ($s.ToLowerInvariant() -replace '[^\p{L}\p{Nd}\s_-]', ' ' -replace '\s+', ' ').Trim()
}

function Score-Overlap([string]$query, [string]$text) {
  $q = Normalize-Text $query
  $t = Normalize-Text $text
  if (-not $q -or -not $t) { return 0 }
  $qtokens = $q.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries) | Select-Object -Unique
  $score = 0
  foreach ($tok in $qtokens) {
    if ($tok.Length -lt 2) { continue }
    if ($t -like "* $tok *" -or $t.StartsWith("$tok ") -or $t.EndsWith(" $tok") -or $t -eq $tok) {
      $score += 1
    }
  }
  if ($score -eq 0) {
    $qflat = $q -replace '\s+', ''
    $tflat = $t -replace '\s+', ''
    if ($qflat.Length -ge 2 -and $tflat.Length -ge 2) {
      for ($i = 0; $i -le $qflat.Length - 2; $i++) {
        $ng = $qflat.Substring($i, 2)
        if ($tflat.Contains($ng)) { $score += 1 }
      }
    }
  }
  return $score
}

$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$indexPath = $config.storage.index_file
if (-not (Test-Path $indexPath)) { '[]'; exit 0 }

$layerPriority = $config.recall.layer_priority
$rows = @()
Get-Content $indexPath | ForEach-Object {
  if (-not $_.Trim()) { return }
  try {
    $obj = $_ | ConvertFrom-Json
    $text = "$($obj.title) $($obj.summary) $($obj.type) $($obj.tags -join ' ')"
    $baseScore = Score-Overlap -query $Query -text $text
    if ($baseScore -lt [int]$config.recall.min_score) { return }
    $layerBoost = 0
    if ($obj.layer -and $layerPriority.PSObject.Properties.Name -contains [string]$obj.layer) {
      $layerBoost = [int]$layerPriority.$($obj.layer)
    }
    $rows += [pscustomobject]@{
      score = $baseScore * 100 + $layerBoost
      obj = $obj
    }
  } catch {}
}

$ranked = $rows |
  Sort-Object -Property @{Expression='score';Descending=$true}, @{Expression={ $_.obj.updated_at };Descending=$true} |
  Select-Object -First ($TopK * 2) |
  ForEach-Object { $_.obj }

$selected = @()
$used = 0
$count = 0
foreach ($it in $ranked) {
  if ($count -ge $TopK) { break }
  $summary = [string]$it.summary
  $size = [Text.Encoding]::UTF8.GetByteCount($summary)
  if (($used + $size) -gt $BudgetBytes) { continue }
  $selected += $it
  $used += $size
  $count += 1
}

$selected | ConvertTo-Json -Depth 6
