# concierge-send.ps1
# Escreve um comando no campo "Comando por Chat" do Concierge e (opcional) manda Enter,
# depois LE a "Resposta" do bot. Identifica o memo editavel pela flag ES_READONLY.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\automation\concierge-send.ps1 -Command "HELP:"
#   powershell -ExecutionPolicy Bypass -File .\automation\concierge-send.ps1 -Command "HELP:" -NoEnter   # so escreve, nao envia
#
# Comece testando com HELP: (seguro - so mostra opcoes, nao muda seu apontamento).

param(
    [string]$Command = "HELP:",
    [switch]$NoEnter
)

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class ConciergeSend {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, string l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, StringBuilder l);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);

    const int GWL_STYLE = -16;
    const int ES_READONLY = 0x0800;
    const int WM_SETTEXT = 0x000C;
    const int WM_GETTEXT = 0x000D;
    const int WM_GETTEXTLENGTH = 0x000E;
    const int WM_KEYDOWN = 0x0100;
    const int WM_KEYUP   = 0x0101;
    const int VK_RETURN  = 0x0D;

    static string Cls(IntPtr h){ var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }

    public static IntPtr FindConcierge() {
        IntPtr f = IntPtr.Zero;
        EnumProc cb = (h,l)=>{ if(Cls(h).IndexOf("TFrm_Concierge",StringComparison.OrdinalIgnoreCase)>=0){f=h;return false;} return true; };
        EnumWindows(cb, IntPtr.Zero); return f;
    }
    static List<IntPtr> Memos(IntPtr p){ var r=new List<IntPtr>(); EnumProc cb=(h,l)=>{ if(Cls(h)=="TMemo") r.Add(h); return true; }; EnumChildWindows(p,cb,IntPtr.Zero); return r; }
    static RECT R(IntPtr h){ RECT r; GetWindowRect(h,out r); return r; }
    static int CX(RECT r){ return (r.L+r.R)/2; }

    // Campo de chat = memo no LADO DIREITO da janela, mais em CIMA.
    // (A "Resposta" fica no mesmo X porem mais embaixo; o status fica a esquerda.)
    public static IntPtr InputMemo(IntPtr concierge) {
        RECT wr = R(concierge); int wcx = CX(wr);
        IntPtr best=IntPtr.Zero; int bestTop=int.MaxValue;
        foreach(var m in Memos(concierge)){
            RECT r = R(m);
            if(CX(r) <= wcx) continue;          // so o lado direito
            if(r.T < bestTop){ bestTop=r.T; best=m; }
        }
        return best;
    }
    // Resposta = memo no lado direito, logo ABAIXO do input (maior Top no lado direito).
    public static IntPtr ResponseMemo(IntPtr concierge) {
        RECT wr = R(concierge); int wcx = CX(wr);
        IntPtr best=IntPtr.Zero; int bestTop=int.MinValue;
        foreach(var m in Memos(concierge)){
            RECT r = R(m);
            if(CX(r) <= wcx) continue;
            if(r.T > bestTop){ bestTop=r.T; best=m; }
        }
        return best;
    }

    public static void SetText(IntPtr h, string txt){ SendMessage(h, WM_SETTEXT, IntPtr.Zero, txt); }
    public static void SendEnter(IntPtr h){
        PostMessage(h, WM_KEYDOWN, (IntPtr)VK_RETURN, IntPtr.Zero);
        PostMessage(h, WM_KEYUP,   (IntPtr)VK_RETURN, IntPtr.Zero);
    }
    public static string GetText(IntPtr h){
        int len=(int)SendMessage(h,WM_GETTEXTLENGTH,IntPtr.Zero,IntPtr.Zero);
        var sb=new StringBuilder(len+1); SendMessage(h,WM_GETTEXT,(IntPtr)(len+1),sb); return sb.ToString();
    }
}
"@

$cz = [ConciergeSend]::FindConcierge()
if ($cz -eq [IntPtr]::Zero) { Write-Host "[!] Concierge nao esta aberto." -ForegroundColor Yellow; return }

$inp = [ConciergeSend]::InputMemo($cz)
if ($inp -eq [IntPtr]::Zero) { Write-Host "[!] Nao achei o memo editavel (campo de chat)." -ForegroundColor Yellow; return }
$resp  = [ConciergeSend]::ResponseMemo($cz)

Write-Host ("Concierge=0x{0:X8}  input=0x{1:X8}  resposta=0x{2:X8}" -f $cz.ToInt64(), $inp.ToInt64(), $resp.ToInt64()) -ForegroundColor Cyan

# captura resposta ANTES, pra comparar
$antes = if ($resp -ne [IntPtr]::Zero) { [ConciergeSend]::GetText($resp) } else { "" }

Write-Host ("`n>> Escrevendo no chat: '{0}'" -f $Command) -ForegroundColor Green
[ConciergeSend]::SetText($inp, $Command)

if ($NoEnter) {
    Write-Host "(-NoEnter) Texto escrito mas NAO enviado. Olhe o campo no Concierge e aperte Enter voce mesmo se quiser." -ForegroundColor Yellow
    return
}

Write-Host ">> Enviando Enter..." -ForegroundColor Green
[ConciergeSend]::SendEnter($inp)

# espera o bot responder
Start-Sleep -Milliseconds 800

$depois = if ($resp -ne [IntPtr]::Zero) { [ConciergeSend]::GetText($resp) } else { "" }

Write-Host "`n=== RESPOSTA DO BOT (depois do comando) ===" -ForegroundColor Cyan
Write-Host $depois
if ($antes -eq $depois) {
    Write-Host "`n[!] A resposta NAO mudou. Pode ser que o Enter nao disparou o envio (mecanismo diferente)." -ForegroundColor Yellow
    Write-Host "    Rode com -NoEnter, confira se o texto apareceu no campo, e me avise." -ForegroundColor Yellow
}
Write-Host "`n=== Fim. Cole a saida. ===" -ForegroundColor Cyan
