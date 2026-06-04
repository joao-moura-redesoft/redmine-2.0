# Bluemine - Start script
Write-Host ""
Write-Host "  Bluemine" -ForegroundColor Cyan
Write-Host "  Iniciando servidor e frontend..." -ForegroundColor Gray
Write-Host ""

$root = $PSScriptRoot

$serverJob = Start-Job -ArgumentList $root -ScriptBlock {
    param($rootPath)
    Set-Location "$rootPath\server"
    node index.js
}

Start-Sleep -Seconds 2

$clientJob = Start-Job -ArgumentList $root -ScriptBlock {
    param($rootPath)
    Set-Location "$rootPath\client"
    npm run dev
}

Start-Sleep -Seconds 3

Write-Host "  Backend:  http://localhost:3001" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "  Abrindo no navegador..." -ForegroundColor Gray

Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "  Pressione Ctrl+C para parar" -ForegroundColor Yellow
Write-Host ""

try {
    while ($true) {
        Receive-Job $serverJob | ForEach-Object { Write-Host "[server] $_" -ForegroundColor DarkGray }
        Receive-Job $clientJob | ForEach-Object { Write-Host "[client] $_" -ForegroundColor DarkGray }
        Start-Sleep -Seconds 2
    }
} finally {
    Stop-Job $serverJob, $clientJob
    Remove-Job $serverJob, $clientJob
    Write-Host "Servidores encerrados." -ForegroundColor Gray
}
