# =============================================================================
# Build do k86-bridge.exe — COMPANION OPCIONAL do Bluemine.
#
# A telinha do teclado Attack Shark K86 é um recurso opt-in (K86_ENABLED=1 no
# .env). O bridge usa módulos NATIVOS (node-hid + @napi-rs/canvas) que não entram
# no SEA do bluemine.exe, então vira um executável separado (via @yao-pkg/pkg).
#
# NÃO faz parte do build principal (build_exe_sea.ps1) de propósito: são ~97 MB
# que só quem tem o teclado precisa. Distribua este exe como asset SEPARADO no
# release; o usuário do K86 baixa e põe na MESMA pasta do bluemine.exe.
#
# Requisitos: Node >= 18 no PATH.
# =============================================================================
$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot"

Write-Host "`nBuild do k86-bridge.exe (companion da telinha do K86)..." -ForegroundColor Cyan

Write-Host "`n1. Instalando deps nativas do bridge..." -ForegroundColor Yellow
Push-Location "$PSScriptRoot\bridge"
npm install --no-audit --no-fund
Pop-Location

Write-Host "`n2. Empacotando com pkg (nativos embutidos)..." -ForegroundColor Yellow
npx --yes @yao-pkg/pkg bridge/index.js --config bridge/package.json --output k86-bridge.exe
if ($LASTEXITCODE -ne 0) { Write-Host "Falha ao empacotar o bridge." -ForegroundColor Red; exit 1 }

Write-Host "`nBuild concluido! k86-bridge.exe gerado na raiz." -ForegroundColor Green
Write-Host "Distribua como asset SEPARADO. O usuario do K86:" -ForegroundColor DarkGray
Write-Host "  1) poe k86-bridge.exe na mesma pasta do bluemine.exe;" -ForegroundColor DarkGray
Write-Host "  2) adiciona K86_ENABLED=1 no .env." -ForegroundColor DarkGray
