Write-Host ""
Write-Host "Iniciando processo de build do kanban.exe..." -ForegroundColor Cyan
Write-Host ""

Write-Host "1. Compilando o frontend (React + Vite)..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\client"
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao compilar o frontend." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "2. Copiando arquivos compilados para a pasta do servidor..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot"
if (Test-Path "server\dist") {
    Remove-Item "server\dist" -Recurse -Force
}
Copy-Item "client\dist" "server\dist" -Recurse -Force

Write-Host ""
Write-Host "3. Gerando o executável com npx pkg..." -ForegroundColor Yellow
npx pkg . --targets node18-win-x64 --output kanban.exe
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao gerar o executavel." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Build concluido! Arquivo kanban.exe foi gerado com sucesso na raiz do projeto." -ForegroundColor Green
Write-Host ""
