# Installs Remote Agent on Windows by running install.sh inside WSL2.
# Remote Agent needs systemd, tmux and Unix sockets, so it runs on Windows only through WSL2.
#
# Usage (PowerShell, in the repo folder): .\install.ps1 [-NoService] [-NoPlugin]
param(
  [switch]$NoService,
  [switch]$NoPlugin
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) {
  Write-Error 'WSL is not installed. In an administrator PowerShell run: wsl --install -d Ubuntu, reboot, then rerun this script.'
  exit 1
}

$repoWsl = (wsl wslpath -a "$PSScriptRoot").Trim()
if (-not $repoWsl) {
  Write-Error 'Could not convert the repo path to a WSL path.'
  exit 1
}

$shellArgs = @()
if ($NoService) { $shellArgs += '--no-service' }
if ($NoPlugin) { $shellArgs += '--no-plugin' }
$shellArgString = $shellArgs -join ' '

Write-Host "Running install.sh in WSL at $repoWsl"
wsl bash -lc "cd '$repoWsl' && chmod +x install.sh && ./install.sh $shellArgString"
exit $LASTEXITCODE
