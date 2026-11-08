#requires -Version 5.1
<#
  Repairs the TV link after the laptop has been switched off and on.

  It does three things:
    1. starts the server if it is not answering,
    2. makes sure Windows Firewall allows TCP 8787 on every network profile
       (Public included) and only from the local network,
    3. sets the current Wi-Fi to Private if Windows marked it Public.

  Windows can re-classify a home Wi-Fi as "Public" after a reboot. A firewall
  rule limited to Private then silently blocks the TV while localhost still
  works, which looks exactly like "the link stopped working".

  Run it from an Administrator PowerShell:
    powershell -ExecutionPolicy Bypass -File scripts\fix-tv-link.ps1
#>

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$port = 8787
$ruleName = 'Home Movie Theatre (TCP 8787)'

function Test-Health {
  try {
    return (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/api/health" -TimeoutSec 2).StatusCode -eq 200
  } catch {
    return $false
  }
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

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

Write-Host 'Home Movie Theatre - TV link repair'
Write-Host '------------------------------------'

# ── 1. server ────────────────────────────────────────────────────────────────
if (-not (Test-Health)) {
  Write-Host 'Server is not running. Starting it...'
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', (Join-Path $PSScriptRoot 'start-movie-theatre.ps1'), '-Quiet' `
    -WindowStyle Hidden
  for ($i = 0; $i -lt 80 -and -not (Test-Health); $i++) {
    Start-Sleep -Milliseconds 500
  }
}

if (Test-Health) {
  Write-Host 'Server: running'
} else {
  Write-Host 'Server: NOT running. Open %TEMP%\hmtheatre.err.log' -ForegroundColor Red
}

# ── 2. firewall ──────────────────────────────────────────────────────────────
if ($isAdmin) {
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($existing) {
    Set-NetFirewallRule -DisplayName $ruleName -Profile Any -RemoteAddress LocalSubnet -Enabled True -ErrorAction SilentlyContinue
  } else {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP `
      -LocalPort $port -Profile Any -RemoteAddress LocalSubnet -ErrorAction SilentlyContinue | Out-Null
  }
  $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($rule) {
    Write-Host "Firewall: open on port $port for the local network (profile: $($rule.Profile))"
  } else {
    Write-Host 'Firewall: could not create the rule.' -ForegroundColor Red
  }
} else {
  Write-Host 'Firewall: skipped (run this script as Administrator to repair it).' -ForegroundColor Yellow
}

# ── 3. network profile ───────────────────────────────────────────────────────
$public = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' }
if ($public) {
  foreach ($profile in $public) {
    if ($isAdmin) {
      try {
        Set-NetConnectionProfile -InterfaceIndex $profile.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
        Write-Host "Network: '$($profile.Name)' was Public - changed to Private."
      } catch {
        Write-Host "Network: '$($profile.Name)' is Public and could not be changed." -ForegroundColor Yellow
      }
    } else {
      Write-Host "Network: '$($profile.Name)' is Public (needs Administrator to change)." -ForegroundColor Yellow
    }
  }
} else {
  Write-Host 'Network: Private (correct for a home Wi-Fi).'
}

# ── 4. result ────────────────────────────────────────────────────────────────
$ip = Get-LanAddress
if ($ip) {
  $url = "http://${ip}:$port"
  Set-Content -Path (Join-Path $env:TEMP 'hmtheatre.url.txt') -Value $url -Encoding ASCII
  Write-Host ''
  Write-Host "Open this on the TV:  $url" -ForegroundColor Green
  Write-Host ''
  Write-Host 'If the TV still cannot connect:'
  Write-Host '  - the TV must be on the same Wi-Fi (not a guest network),'
  Write-Host '  - try the router name instead:  http://ShahriarShihab.lan:8787'
  Write-Host '  - make sure you are signed in to Windows (auto-start runs at sign-in).'
} else {
  Write-Host 'No local network address found. Is Wi-Fi connected?' -ForegroundColor Red
}
