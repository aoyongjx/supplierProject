param(
  [string]$TranscriptPath,
  [string]$InputText,
  [string]$SessionId,
  [string]$Project = 'default',
  [int]$MaxChars = 6000
)

$ErrorActionPreference='Stop'

function To-Lines([string]$text) {
  if (-not $text) { return @() }
  return $text -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 }
}

if (-not $InputText -and $TranscriptPath) {
  if (-not (Test-Path $TranscriptPath)) { throw "Transcript file not found: $TranscriptPath" }
  $InputText = Get-Content -Raw $TranscriptPath
}
if (-not $InputText) { throw 'Provide -InputText or -TranscriptPath' }

if ($InputText.Length -gt $MaxChars) {
  $InputText = $InputText.Substring(0, $MaxChars)
}

$lines = To-Lines $InputText
$userLines = $lines | Where-Object { $_ -match '^(User)[:：]' }
$assistantLines = $lines | Where-Object { $_ -match '^(Assistant|Codex)[:：]' }

$topUser = $userLines | Select-Object -First 5
$latestUser = $userLines | Select-Object -Last 3
$latestAssistant = $assistantLines | Select-Object -Last 3

if (-not $SessionId) {
  $SessionId = (Get-Date).ToString('yyyyMMdd-HHmmss')
}
$now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$title = "Session summary $SessionId"
$summary = @(
  "会话时间: $now",
  "项目: $Project",
  "",
  '主要用户诉求（前几条）:',
  ($topUser -join "`n"),
  '',
  '最近用户消息:',
  ($latestUser -join "`n"),
  '',
  '最近助手输出:',
  ($latestAssistant -join "`n")
) -join "`n"

$saveScript = Join-Path $PSScriptRoot 'save-memory.ps1'
& $saveScript `
  -Type 'project' `
  -Title $title `
  -Summary $summary `
  -Layer 'L1_session' `
  -Source 'session-summary' `
  -Tags @('session','summary',$Project)
