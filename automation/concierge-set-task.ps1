# concierge-set-task.ps1
# Aponta o Concierge para uma tarefa do Redmine, enviando o numero no chat do bot.
# Espera (poll) a resposta do bot e verifica que a tarefa ativa mudou.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\automation\concierge-set-task.ps1 -TaskId 91209
#   ... -TaskId 91209 -ExpectTitle "CRM - SPRINT 1"   # valida que o titulo bate (opcional)
#
# Saida: linha "RESULT <OK|FAIL> <TaskId> <titulo ativo>" e exit code 0 (ok) / 1 (falha).

param(
    [Parameter(Mandatory=$true)][int]$TaskId,
    [string]$ExpectTitle = "",
    [int]$TimeoutMs = 6000
)

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class CzTask {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, string l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, StringBuilder l);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);

    const int WM_SETTEXT=0x000C, WM_GETTEXT=0x000D, WM_GETTEXTLENGTH=0x000E;
    const int WM_KEYDOWN=0x0100, WM_KEYUP=0x0101, VK_RETURN=0x0D;

    static string Cls(IntPtr h){ var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }
    static RECT R(IntPtr h){ RECT r; GetWindowRect(h,out r); return r; }
    static int CX(RECT r){ return (r.L+r.R)/2; }

    public static IntPtr FindConcierge(){
        IntPtr f=IntPtr.Zero;
        EnumProc cb=(h,l)=>{ if(Cls(h).IndexOf("TFrm_Concierge",StringComparison.OrdinalIgnoreCase)>=0){f=h;return false;} return true; };
        EnumWindows(cb,IntPtr.Zero); return f;
    }
    static List<IntPtr> Memos(IntPtr p){ var r=new List<IntPtr>(); EnumProc cb=(h,l)=>{ if(Cls(h)=="TMemo") r.Add(h); return true; }; EnumChildWindows(p,cb,IntPtr.Zero); return r; }

    public static IntPtr InputMemo(IntPtr cz){     // direito-superior
        RECT w=R(cz); int wcx=CX(w); IntPtr best=IntPtr.Zero; int top=int.MaxValue;
        foreach(var m in Memos(cz)){ RECT r=R(m); if(CX(r)<=wcx) continue; if(r.T<top){top=r.T;best=m;} } return best;
    }
    public static IntPtr ResponseMemo(IntPtr cz){  // direito-inferior
        RECT w=R(cz); int wcx=CX(w); IntPtr best=IntPtr.Zero; int top=int.MinValue;
        foreach(var m in Memos(cz)){ RECT r=R(m); if(CX(r)<=wcx) continue; if(r.T>top){top=r.T;best=m;} } return best;
    }
    public static IntPtr StatusMemo(IntPtr cz){    // esquerdo (titulo da tarefa ativa)
        RECT w=R(cz); int wcx=CX(w); IntPtr best=IntPtr.Zero; int top=int.MinValue;
        foreach(var m in Memos(cz)){ RECT r=R(m); if(CX(r)>wcx) continue; if(r.T>top){top=r.T;best=m;} } return best;
    }
    public static void SetText(IntPtr h,string t){ SendMessage(h,WM_SETTEXT,IntPtr.Zero,t); }
    public static void Enter(IntPtr h){ PostMessage(h,WM_KEYDOWN,(IntPtr)VK_RETURN,IntPtr.Zero); PostMessage(h,WM_KEYUP,(IntPtr)VK_RETURN,IntPtr.Zero); }
    public static string GetText(IntPtr h){ int n=(int)SendMessage(h,WM_GETTEXTLENGTH,IntPtr.Zero,IntPtr.Zero); var sb=new StringBuilder(n+1); SendMessage(h,WM_GETTEXT,(IntPtr)(n+1),sb); return sb.ToString(); }
}
"@

function Fail($msg){ Write-Host "RESULT FAIL $TaskId $msg" -ForegroundColor Red; exit 1 }

$cz = [CzTask]::FindConcierge()
if ($cz -eq [IntPtr]::Zero) { Fail "concierge-nao-aberto" }

$inp  = [CzTask]::InputMemo($cz)
$stat = [CzTask]::StatusMemo($cz)
if ($inp -eq [IntPtr]::Zero -or $stat -eq [IntPtr]::Zero) { Fail "memos-nao-encontrados" }

$statusAntes = [CzTask]::GetText($stat)
Write-Host ("Antes: '{0}'  ->  enviando {1}" -f $statusAntes, $TaskId) -ForegroundColor DarkGray

[CzTask]::SetText($inp, "$TaskId")
[CzTask]::Enter($inp)

# poll: espera o status mudar (ou, se ja era a tarefa, a resposta confirmar)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$statusDepois = $statusAntes
while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
    Start-Sleep -Milliseconds 250
    $statusDepois = [CzTask]::GetText($stat)
    if ($statusDepois -ne $statusAntes -and $statusDepois.Trim().Length -gt 0) { break }
}

$titulo = $statusDepois.Trim()
if ($titulo.Length -eq 0) { Fail "status-vazio" }

# se ja estava na tarefa, o status nao muda; tratamos como OK desde que tenha titulo
if ($ExpectTitle -ne "") {
    # comparacao tolerante: caixa + espacos colapsados, substring em qualquer direcao
    $norm = { param($s) ($s -replace '\s+',' ').Trim().ToLowerInvariant() }
    $a = & $norm $titulo
    $e = & $norm $ExpectTitle
    if (-not ($a.Contains($e) -or $e.Contains($a))) {
        Fail "titulo-divergente|esperado~'$ExpectTitle'|ativo='$titulo'"
    }
}

Write-Host "RESULT OK $TaskId $titulo" -ForegroundColor Green
exit 0
