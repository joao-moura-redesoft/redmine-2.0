# concierge-login.ps1
# Garante o b2click aberto e LOGADO (login automatico com senha do Credential Manager).
# Depois de logar, voce abre o Concierge pelo menu (Modulo REDESOFT > Redesoft > 3. Concierge).
#
# Pre-requisito: rode antes, uma vez, .\automation\store-concierge-credential.ps1
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\automation\concierge-login.ps1
#
# Saida: "LOGIN OK" / "JA LOGADO" / "LOGIN FAIL <motivo>".

param(
    [string]$ExePath = "C:\Redesoft\b2click\redeerp.exe",
    [string]$CredTarget = "b2click-concierge",
    [int]$WaitMs = 60000
)

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Login {
    public delegate bool EP(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EP cb, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EP cb, IntPtr p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, string l);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, int msg, IntPtr w, IntPtr l);

    const int GWL_STYLE=-16, ES_PASSWORD=0x0020;
    const int WM_SETTEXT=0x000C, BM_CLICK=0x00F5, WM_KEYDOWN=0x0100, WM_KEYUP=0x0101, VK_RETURN=0x0D;

    static string Cls(IntPtr h){ var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }
    static string Txt(IntPtr h){ int n=GetWindowTextLength(h); if(n<=0) return ""; var s=new StringBuilder(n+1); GetWindowText(h,s,n+1); return s.ToString(); }

    public static IntPtr FindWin(string frag){ IntPtr f=IntPtr.Zero; EP cb=(h,l)=>{ if(Cls(h).IndexOf(frag,StringComparison.OrdinalIgnoreCase)>=0){f=h;return false;} return true; }; EnumWindows(cb,IntPtr.Zero); return f; }

    // campo Senha = TEdit com estilo ES_PASSWORD
    public static IntPtr PasswordEdit(IntPtr login){
        IntPtr found=IntPtr.Zero;
        EP cb=(h,l)=>{ if(Cls(h)=="TEdit" && (GetWindowLong(h,GWL_STYLE)&ES_PASSWORD)!=0){ found=h; return false; } return true; };
        EnumChildWindows(login,cb,IntPtr.Zero); return found;
    }
    // TComboBox da entidade (primeiro TComboBox filho)
    public static IntPtr EntityCombo(IntPtr login){
        IntPtr found=IntPtr.Zero;
        EP cb=(h,l)=>{ if(Cls(h)=="TComboBox"){ found=h; return false; } return true; };
        EnumChildWindows(login,cb,IntPtr.Zero); return found;
    }
    public static string ComboText(IntPtr h){ return Txt(h); }
    // botao "Acessar"
    public static IntPtr AccessButton(IntPtr login){
        IntPtr found=IntPtr.Zero;
        EP cb=(h,l)=>{ if(Cls(h).StartsWith("TPng") && Txt(h).Replace("&","").IndexOf("Acessar",StringComparison.OrdinalIgnoreCase)>=0){ found=h; return false; } return true; };
        EnumChildWindows(login,cb,IntPtr.Zero); return found;
    }
    public static void SetText(IntPtr h,string t){ SendMessage(h,WM_SETTEXT,IntPtr.Zero,t); }
    public static void Click(IntPtr h){ SendMessage(h,BM_CLICK,IntPtr.Zero,IntPtr.Zero); }
    public static void Enter(IntPtr h){ PostMessage(h,WM_KEYDOWN,(IntPtr)VK_RETURN,IntPtr.Zero); PostMessage(h,WM_KEYUP,(IntPtr)VK_RETURN,IntPtr.Zero); }
}

public class CredR {
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CredRead(string target, uint type, uint flags, out IntPtr cred);
    [DllImport("advapi32.dll")] static extern void CredFree(IntPtr cred);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct CREDENTIAL { public uint Flags, Type; public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize; public IntPtr CredentialBlob;
        public uint Persist, AttributeCount; public IntPtr Attributes; public string TargetAlias, UserName; }
    public static string Read(string target){
        IntPtr p;
        if(!CredRead(target,1,0,out p)) return null;
        try{
            var c=(CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
            if(c.CredentialBlobSize==0) return "";
            byte[] b=new byte[c.CredentialBlobSize];
            Marshal.Copy(c.CredentialBlob,b,0,(int)c.CredentialBlobSize);
            return Encoding.Unicode.GetString(b);
        } finally { CredFree(p); }
    }
}
"@

function Fail($m){ Write-Host "LOGIN FAIL $m" -ForegroundColor Red; exit 1 }

# ja logado?
if ([Login]::FindWin("TFrm_Concierge") -ne [IntPtr]::Zero -or [Login]::FindWin("TFrm_MenuPrincipal") -ne [IntPtr]::Zero) {
    Write-Host "JA LOGADO (app aberto). Abra o Concierge pelo menu se precisar." -ForegroundColor Green; exit 0
}

# senha do cofre
$pw = [CredR]::Read($CredTarget)
if ($null -eq $pw) { Fail "sem-credencial|rode store-concierge-credential.ps1" }

# tela de login aberta? senao, abre o exe e espera
$login = [Login]::FindWin("TFrm_Login")
if ($login -eq [IntPtr]::Zero) {
    if (-not (Test-Path $ExePath)) { Fail "exe-nao-encontrado|$ExePath" }
    Write-Host "Abrindo $ExePath ..." -ForegroundColor DarkGray
    Start-Process $ExePath | Out-Null
    $sw=[System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $WaitMs) {
        Start-Sleep -Milliseconds 500
        $login = [Login]::FindWin("TFrm_Login")
        if ($login -ne [IntPtr]::Zero) { break }
        if ([Login]::FindWin("TFrm_MenuPrincipal") -ne [IntPtr]::Zero) { Write-Host "JA LOGADO" -ForegroundColor Green; exit 0 }
    }
    if ($login -eq [IntPtr]::Zero) { Fail "login-nao-apareceu" }
}

# aguarda o TComboBox de entidade carregar (sai do "?" ou vazio)
Write-Host "Aguardando entidade carregar..." -ForegroundColor DarkGray
$sw2=[System.Diagnostics.Stopwatch]::StartNew()
while ($sw2.ElapsedMilliseconds -lt 30000) {
    Start-Sleep -Milliseconds 500
    $combo = [Login]::EntityCombo($login)
    if ($combo -ne [IntPtr]::Zero) {
        $entidade = [Login]::ComboText($combo)
        if ($entidade.Length -gt 0 -and $entidade -ne "?") {
            Write-Host "Entidade: '$entidade'" -ForegroundColor DarkGray
            break
        }
    }
}

# pequena margem apos o combobox estabilizar
Start-Sleep -Milliseconds 800

$senha = [Login]::PasswordEdit($login)
if ($senha -eq [IntPtr]::Zero) { Fail "campo-senha-nao-achado" }
[Login]::SetText($senha, $pw)

$btn = [Login]::AccessButton($login)
if ($btn -ne [IntPtr]::Zero) { [Login]::Click($btn) } else { [Login]::Enter($senha) }

# confirma: login sumiu / menu apareceu
$sw=[System.Diagnostics.Stopwatch]::StartNew()
while ($sw.ElapsedMilliseconds -lt $WaitMs) {
    Start-Sleep -Milliseconds 400
    if ([Login]::FindWin("TFrm_MenuPrincipal") -ne [IntPtr]::Zero) { Write-Host "LOGIN OK" -ForegroundColor Green; exit 0 }
    if ([Login]::FindWin("TFrm_Login") -eq [IntPtr]::Zero) { Write-Host "LOGIN OK (login fechou)" -ForegroundColor Green; exit 0 }
}
Fail "nao-confirmou|senha-errada-ou-botao-nao-acionou"
