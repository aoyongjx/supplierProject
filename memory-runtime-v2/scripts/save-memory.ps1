param(
  [Parameter(Mandatory=$true)][ValidateSet('user','feedback','project','reference')] [string]$Type,
  [Parameter(Mandatory=$true)][string]$Title,
  [Parameter(Mandatory=$true)][string]$Summary,
  [string[]]$Tags,
  [ValidateSet('L1_session','L2_episode','L3_semantic','L4_policy')] [string]$Layer,
  [string]$Source = 'manual',
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
if (-not $ConfigPath) {
  $ConfigPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'config\memory.config.json'
}

function Normalize-Text([string]$s) {
  if (-not $s) { return '' }
  return ($s.ToLowerInvariant() -replace '[^\p{L}\p{Nd}\s_-]', ' ' -replace '\s+', ' ').Trim()
}

function Ensure-Dir([string]$p) {
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$indexPath = $config.storage.index_file
$baseData = $config.storage.base_dir

if (-not $Layer) {
  $Layer = $config.save.default_layer_by_type.$Type
}

if (-not $Tags) { $Tags = @() }
$Tags = $Tags | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique

$deny = @($config.save.deny_sensitive_patterns)
foreach ($p in $deny) {
  if ($Summary -match [regex]::Escape($p) -or $Title -match [regex]::Escape($p)) {
    throw "Rejected by sensitive pattern rule: $p"
  }
}

$now = (Get-Date).ToUniversalTime().ToString('o')
$titleKey = Normalize-Text $Title
$key = "${Type}::${titleKey}"
$slug = ((Normalize-Text $Title) -replace '\s+', '-')
if (-not $slug) { $slug = 'memory' }

$layerDir = Join-Path (Join-Path $baseData 'layers') $Layer
Ensure-Dir $layerDir
$entryPath = Join-Path $layerDir ("$Type-$slug.md")

$frontmatter = @(
  '---',
  "name: $Title",
  "type: $Type",
  "layer: $Layer",
  ('tags: [' + (($Tags | ForEach-Object { '"' + $_ + '"' }) -join ', ') + ']'),
  "updated_at: $now",
  "source: $Source",
  '---',
  '',
  $Summary,
  ''
) -join "`n"
Set-Content -Encoding UTF8 -Path $entryPath -Value $frontmatter

Ensure-Dir (Split-Path $indexPath -Parent)
$all = @()
if (Test-Path $indexPath) {
  Get-Content $indexPath | ForEach-Object {
    if (-not $_.Trim()) { return }
    try { $all += ($_ | ConvertFrom-Json) } catch {}
  }
}
$all = @($all | Where-Object { $_.key -ne $key })
$all += [pscustomobject]@{
  key = $key
  type = $Type
  title = $Title
  title_key = $titleKey
  summary = $Summary
  tags = $Tags
  layer = $Layer
  source = $Source
  path = $entryPath
  updated_at = $now
}
$all = @($all | Sort-Object -Property updated_at)
$all | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 6 } | Set-Content -Encoding UTF8 -Path $indexPath

$all[-1] | ConvertTo-Json -Depth 6
