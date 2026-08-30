# Deploy Profit Compass to the Hetzner server (Windows, uses built-in OpenSSH + tar).
# Usage:  .\deploy.ps1              (defaults: root@5.223.71.214, port 8018)
#         .\deploy.ps1 -Target user@host -Port 8018
param(
    [string]$Target = "root@5.223.71.214",
    [int]$Port = 8018
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "==> packaging"
tar --exclude=.git --exclude=.env --exclude=backend/data/app.db `
    -czf "$env:TEMP\profit-compass.tar.gz" `
    backend frontend Dockerfile docker-compose.yml .env.example README.md

Write-Host "==> uploading to $Target"
ssh $Target "mkdir -p /opt/profit-compass"
scp "$env:TEMP\profit-compass.tar.gz" "${Target}:/opt/profit-compass/"

Write-Host "==> extracting + building image on server (container NOT started yet)"
ssh $Target "cd /opt/profit-compass && tar xzf profit-compass.tar.gz && rm profit-compass.tar.gz && ([ -f .env ] || cp .env.example .env) && docker compose build"

Write-Host ""
Write-Host "==> SETUP DONE. De chay app:"
Write-Host "    1. ssh $Target"
Write-Host "    2. nano /opt/profit-compass/.env      # dien ANTHROPIC_API_KEY that"
Write-Host "    3. cd /opt/profit-compass && docker compose up -d"
Write-Host "    App: http://5.223.71.214:$Port  (kiem tra: /api/health)"
