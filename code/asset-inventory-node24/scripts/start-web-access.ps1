param(
  [string]$TargetUrl = ""
)

$ErrorActionPreference = "Stop"

$proxyHealthUrl = "http://127.0.0.1:3456/health"
$proxyNewBaseUrl = "http://127.0.0.1:3456/new?url="
$proxyScript = "C:\Users\aoyon\.codex\skills\web-access\scripts\cdp-proxy.mjs"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$proxyTabIdleTimeoutMs = "43200000"

function Test-WebAccessProxyHealthy {
  try {
    $resp = Invoke-RestMethod -Uri $proxyHealthUrl -Method Get -TimeoutSec 2
    return ($resp.status -eq "ok")
  } catch {
    return $false
  }
}

function Ensure-NodeCommand {
  if (Test-Path -LiteralPath $nodeExe) {
    return $nodeExe
  }
  return "node"
}

if (-not (Test-Path -LiteralPath $proxyScript)) {
  throw "web-access proxy script not found: $proxyScript"
}

$alreadyReady = Test-WebAccessProxyHealthy
if (-not $alreadyReady) {
  $stale = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "node.exe" -and [string]$_.CommandLine -like "*cdp-proxy.mjs*"
  }
  foreach ($proc in $stale) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      Write-Output "stale proxy process stopped: $($proc.ProcessId)"
    } catch {
      Write-Output "stale proxy process stop skipped: $($proc.ProcessId)"
    }
  }

  $nodeCommand = Ensure-NodeCommand
  $env:CDP_TAB_IDLE_TIMEOUT = $proxyTabIdleTimeoutMs
  Start-Process -FilePath $nodeCommand -ArgumentList @($proxyScript) -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Milliseconds 700
    if (Test-WebAccessProxyHealthy) {
      $ready = $true
      break
    }
  }
  if (-not $ready) {
    throw "web-access proxy start timeout (port 3456 not healthy)"
  }
}

Write-Output "web-access proxy ready"

if ([string]::IsNullOrWhiteSpace($TargetUrl)) {
  exit 0
}

if (-not (Test-WebAccessProxyHealthy)) {
  throw "web-access proxy is not healthy while opening target url"
}

$encodedTargetUrl = [uri]::EscapeDataString($TargetUrl)
try {
  Invoke-RestMethod -Uri ($proxyNewBaseUrl + $encodedTargetUrl) -Method Get -TimeoutSec 8 | Out-Null
  Write-Output "target opened: $TargetUrl"
} catch {
  throw ("open target failed: " + $_.Exception.Message)
}

exit 0
