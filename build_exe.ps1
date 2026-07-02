Write-Host ""
Write-Host "Iniciando processo de build do bluemine.exe..." -ForegroundColor Cyan
Write-Host ""

Write-Host "1. Gerando icones (diamante) a partir de build/bluemine.svg..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot"
node scripts/make-icon.cjs
if ($LASTEXITCODE -ne 0) { Write-Host "Erro ao gerar os icones." -ForegroundColor Red; exit $LASTEXITCODE }

Write-Host ""
Write-Host "2. Compilando o frontend (React + Vite)..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\client"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Erro ao compilar o frontend." -ForegroundColor Red; exit $LASTEXITCODE }

Write-Host ""
Write-Host "3. Copiando arquivos compilados para a pasta do servidor..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot"
if (Test-Path "server\dist") { Remove-Item "server\dist" -Recurse -Force }
Copy-Item "client\dist" "server\dist" -Recurse -Force

Write-Host ""
Write-Host "4. Preparando base do pkg (fetch) ..." -ForegroundColor Yellow
# 1a passada: garante que o binario-base do node esteja no cache do pkg.
npx pkg . --targets node18-win-x64 --output bluemine.exe
if ($LASTEXITCODE -ne 0) { Write-Host "Erro ao gerar o executavel." -ForegroundColor Red; exit $LASTEXITCODE }

Write-Host ""
Write-Host "5. Gravando o icone no binario-base do pkg..." -ForegroundColor Yellow
# O pkg ANEXA o payload ao binario-base; por isso o icone deve ser gravado no base
# (antes de empacotar). Gravar no exe final truncaria o payload.
$base = Get-ChildItem "$env:USERPROFILE\.pkg-cache" -Recurse -Filter "fetched-*-win-x64*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($base) {
    node scripts/set-exe-icon.cjs "$($base.FullName)"
    if ($LASTEXITCODE -ne 0) { Write-Host "Aviso: nao foi possivel gravar o icone no base." -ForegroundColor DarkYellow }
    Write-Host "6. Reempacotando com o icone..." -ForegroundColor Yellow
    Remove-Item "bluemine.exe" -Force -ErrorAction SilentlyContinue
    $env:PKG_IGNORE_TAG = "1"
    npx pkg . --targets node18-win-x64 --output bluemine.exe
    $env:PKG_IGNORE_TAG = $null
    if ($LASTEXITCODE -ne 0) { Write-Host "Erro ao reempacotar." -ForegroundColor Red; exit $LASTEXITCODE }
} else {
    Write-Host "Aviso: binario-base do pkg nao encontrado; exe gerado sem icone." -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "Build concluido! bluemine.exe gerado na raiz do projeto." -ForegroundColor Green
Write-Host ""
