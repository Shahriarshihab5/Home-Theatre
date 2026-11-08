#requires -Version 5.1
<#
  Starts Home Movie Theatre in the background (hidden) and waits until it is
  actually answering. Safe to run repeatedly: if the server is already up it
  does nothing.

  Used by the Windows logon task and by the desktop shortcut.
#>

param(
  [switch]$Open,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
}
if (-not $node -or -not (Test-Path $node)) {
  if (-not $Quiet) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      'Node.js was not found. Install Node.js 20 or newer, then run this shortcut again.',
      'Home Movie Theatre'
    ) | Out-Null
  }
  exit 1
}

$port = 8787
$healthUrl = "http://127.0.0.1:$port/api/health"
$outLog = Join-Path $env:TEMP 'hmtheatre.out.log'
$errLog = Join-Path $env:TEMP 'hmtheatre.err.log'

function Test-Port {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $port)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-ForServer {
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return $true }
    } catch {
      # not ready yet
    }
  }
  return $false
}

function Get-LanAddress {
  $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and
      $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Hyper-V|Bluetooth'
    } |
    Sort-Object -Property InterfaceAlias
  return ($addresses | Select-Object -First 1 -ExpandProperty IPAddress)
}

if (-not (Test-Port)) {
  Start-Process -FilePath $node `
    -ArgumentList 'server/index.js' `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog
}

$ready = Wait-ForServer
$ip = Get-LanAddress
$tvUrl = if ($ip) { "http://${ip}:$port" } else { "http://localhost:$port" }

if (-not $ready) {
  if (-not $Quiet) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      "The server did not start. Check the log:`n$errLog",
      'Home Movie Theatre'
    ) | Out-Null
  }
  exit 1
}

Set-Content -Path (Join-Path $env:TEMP 'hmtheatre.url.txt') -Value $tvUrl -Encoding ASCII

if ($Open) {
  Start-Process $tvUrl
}

if (-not $Quiet) {
  Write-Host "Home Movie Theatre is running."
  Write-Host "TV address: $tvUrl"
}
