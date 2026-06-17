# inspect-concierge.ps1
# Rode com o CONCIERGE ABERTO (a janela com "Comando por Chat" visivel).
# Nao instala nada (usa UIAutomation do .NET).
# Acha a janela do Concierge pelo conteudo e mostra a arvore de controles.

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$AE   = [System.Windows.Automation.AutomationElement]
$root = $AE::RootElement

function Dump-Tree {
    param($element, [int]$depth = 0, [int]$maxDepth = 8)
    if ($depth -gt $maxDepth) { return }
    $indent = '  ' * $depth
    $c = $element.Current
    $rect = $c.BoundingRectangle
    # marca controles "interessantes" pra automacao
    $tag = ''
    $ct  = $c.ControlType.ProgrammaticName.Replace('ControlType.','')
    if ($ct -in @('Edit','Document','Text') -and $rect.Width -gt 200) { $tag = '   <== CAMPO GRANDE' }
    if ($ct -eq 'Edit' -or $ct -eq 'Document') { $tag = '   <== EDITAVEL' }
    Write-Host ("{0}[{1}] Name='{2}' AutoId='{3}' Class='{4}' Rect=({5:N0},{6:N0},{7:N0}x{8:N0}){9}" -f `
        $indent, $ct, $c.Name, $c.AutomationId, $c.ClassName, $rect.X, $rect.Y, $rect.Width, $rect.Height, $tag)

    $children = $element.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($child in $children) { Dump-Tree -element $child -depth ($depth + 1) -maxDepth $maxDepth }
}

# 1) Lista todas as janelas de topo
$cond = New-Object System.Windows.Automation.PropertyCondition(
    $AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)

Write-Host "`n=== Janelas de topo visiveis ===" -ForegroundColor Cyan
$i = 0
foreach ($w in $windows) {
    if ($w.Current.Name) {
        Write-Host ("  [{0}] '{1}'  (class={2})" -f $i, $w.Current.Name, $w.Current.ClassName)
    }
    $i++
}

# 2) Acha a janela que contem o texto "Comando por Chat" (a do Concierge)
$textCond = New-Object System.Windows.Automation.PropertyCondition(
    $AE::NameProperty, 'Comando por Chat')
$chatLabel = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $textCond)

$target = $null
if ($chatLabel) {
    # sobe ate achar a janela (Window) ancestral
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $node = $chatLabel
    while ($node -and $node.Current.ControlType.ProgrammaticName -notmatch 'Window') {
        $node = $walker.GetParent($node)
    }
    $target = $node
}

if (-not $target) {
    # fallback: janela cujo nome contem Concierge
    foreach ($w in $windows) { if ($w.Current.Name -match 'Concierge') { $target = $w; break } }
}

if (-not $target) {
    Write-Host "`n[!] Nao achei a janela do Concierge nem o texto 'Comando por Chat'." -ForegroundColor Yellow
    Write-Host "    Confirme que a janela do Concierge esta ABERTA e rode de novo." -ForegroundColor Yellow
    return
}

Write-Host ("`n=== Arvore da janela do Concierge: '{0}' (class={1}) ===" -f `
    $target.Current.Name, $target.Current.ClassName) -ForegroundColor Cyan
Write-Host "Foco: controles marcados com <== sao candidatos ao campo 'Comando por Chat' e a grade de tarefas.`n"
Dump-Tree -element $target

Write-Host "`n=== Fim. Cole essa saida de volta. ===" -ForegroundColor Cyan
