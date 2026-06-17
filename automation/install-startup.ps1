# install-startup.ps1
# Instala o concierge-login como atalho de inicializacao do Windows.
# Ao logar, o app b2click abre e loga automaticamente (sem janela visivel).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\automation\install-startup.ps1
#
# Para desinstalar:
#   Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\startup-concierge.vbs"

$src = Join-Path $PSScriptRoot "startup-concierge.vbs"
$startupDir = [Environment]::GetFolderPath("Startup")
$dst = Join-Path $startupDir "startup-concierge.vbs"

if (-not (Test-Path $src)) {
    Write-Host "ERRO: $src nao encontrado." -ForegroundColor Red; exit 1
}

Copy-Item -Path $src -Destination $dst -Force
Write-Host "OK: '$dst' instalado." -ForegroundColor Green
Write-Host "    Na proxima vez que voce logar no Windows, o b2click vai abrir e logar sozinho." -ForegroundColor DarkGray
Write-Host "    (voce ainda precisa abrir o Concierge pelo menu: Modulo REDESOFT > Redesoft > 3. Concierge)" -ForegroundColor DarkGray
