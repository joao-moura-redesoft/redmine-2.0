# =============================================================================
# Build do bluemine.exe via Node SEA (Single Executable Applications).
#
# Substitui o pipeline `pkg`/node18 (build_exe.ps1), que ficava preso ao Node 18
# (EOL). Aqui o executável usa o binário do Node LTS instalado nesta máquina
# (>= 20). O app é bundlado num único .cjs (esbuild) e o frontend é EMBUTIDO no
# bundle (scripts/embed-dist.cjs), gerando um .exe realmente single-file.
#
# Requisitos: Node >= 20 no PATH; deps instaladas (npm ci na raiz e no client).
# =============================================================================
$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot"

$FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

function Step($n, $msg) { Write-Host "`n$n. $msg" -ForegroundColor Yellow }

# Guard: SEA exige Node 20+.
$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
if ($nodeMajor -lt 20) { Write-Host "Node >= 20 requerido para SEA (atual: $nodeMajor)." -ForegroundColor Red; exit 1 }

Write-Host "`nBuild do bluemine.exe (Node SEA, node$nodeMajor)..." -ForegroundColor Cyan

Step 1 "Gerando icones..."
node scripts/make-icon.cjs

Step 2 "Compilando o frontend (React + Vite)..."
Set-Location "$PSScriptRoot\client"; npm run build; Set-Location "$PSScriptRoot"

Step 3 "Embutindo o frontend no servidor (dist-embedded.cjs)..."
node scripts/embed-dist.cjs

Step 4 "Bundlando o servidor num unico .cjs (esbuild)..."
New-Item -ItemType Directory -Force build | Out-Null
npx esbuild server/index.js --bundle --platform=node --format=cjs --target="node$nodeMajor" --outfile=build/bluemine.bundle.cjs

Step 5 "Gerando o blob SEA..."
node --experimental-sea-config sea-config.json

Step 6 "Copiando o binario do Node para bluemine.exe..."
node -e "require('fs').copyFileSync(process.execPath, 'bluemine.exe')"

Step 7 "Injetando o blob no executavel (postject)..."
npx --yes postject bluemine.exe NODE_SEA_BLOB build/bluemine.blob --sentinel-fuse $FUSE
if ($LASTEXITCODE -ne 0) { Write-Host "Falha ao injetar o blob." -ForegroundColor Red; exit 1 }

Step 8 "Gravando o icone no executavel..."
try { node scripts/set-exe-icon.cjs "bluemine.exe" } catch { Write-Host "Aviso: nao foi possivel gravar o icone." -ForegroundColor DarkYellow }

Step 9 "Marcando o binario como GUI (sem janela de console)..."
node scripts/set-gui-subsystem.cjs "bluemine.exe"
if ($LASTEXITCODE -ne 0) { Write-Host "Falha ao marcar como GUI." -ForegroundColor Red; exit 1 }

Write-Host "`nBuild concluido! bluemine.exe (SEA) gerado na raiz." -ForegroundColor Green
Write-Host "Dica: assine o binario (signtool) antes de distribuir." -ForegroundColor DarkGray
Write-Host "Opcional: a telinha do teclado K86 e um COMPANION a parte -> rode build_bridge.ps1" -ForegroundColor DarkGray
