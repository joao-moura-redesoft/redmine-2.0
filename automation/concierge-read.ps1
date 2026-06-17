# concierge-read.ps1  (NAO-DESTRUTIVO)
# Le o estado atual do Concierge: identifica os 3 TMemo, mostra se sao
# editaveis (ES_READONLY) e o texto atual de cada um. Nao envia nada ao bot.

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class ConciergeRead {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr wParam, StringBuilder lParam);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);

    const int GWL_STYLE = -16;
    const int ES_READONLY = 0x0800;
    const int WM_GETTEXT = 0x000D;
    const int WM_GETTEXTLENGTH = 0x000E;

    static string Cls(IntPtr h){ var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }

    public static IntPtr FindConcierge() {
        IntPtr found = IntPtr.Zero;
        EnumProc cb = (h,l) => { if(Cls(h).IndexOf("TFrm_Concierge",StringComparison.OrdinalIgnoreCase)>=0){found=h;return false;} return true; };
        EnumWindows(cb, IntPtr.Zero);
        return found;
    }

    public static List<IntPtr> Memos(IntPtr parent) {
        var list = new List<IntPtr>();
        EnumProc cb = (h,l) => { if(Cls(h)=="TMemo") list.Add(h); return true; };
        EnumChildWindows(parent, cb, IntPtr.Zero);
        return list;
    }

    public static bool IsReadOnly(IntPtr h){ return (GetWindowLong(h, GWL_STYLE) & ES_READONLY) != 0; }

    public static string GetText(IntPtr h) {
        int len = (int)SendMessage(h, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero);
        var sb = new StringBuilder(len + 1);
        SendMessage(h, WM_GETTEXT, (IntPtr)(len+1), sb);
        return sb.ToString();
    }

    public static string RectOf(IntPtr h){ RECT r; GetWindowRect(h,out r); return string.Format("({0},{1} {2}x{3})", r.L, r.T, r.R-r.L, r.B-r.T); }
}
"@

$cz = [ConciergeRead]::FindConcierge()
if ($cz -eq [IntPtr]::Zero) { Write-Host "[!] Concierge nao esta aberto." -ForegroundColor Yellow; return }

Write-Host ("`n=== Concierge HWND=0x{0:X8} ===" -f $cz.ToInt64()) -ForegroundColor Cyan
$memos = [ConciergeRead]::Memos($cz)
Write-Host ("TMemos encontrados: {0}`n" -f $memos.Count)

$idx = 0
foreach ($m in $memos) {
    $ro   = [ConciergeRead]::IsReadOnly($m)
    $rect = [ConciergeRead]::RectOf($m)
    $txt  = [ConciergeRead]::GetText($m)
    $tag  = if ($ro) { 'READONLY' } else { 'EDITAVEL  <== campo de comando' }
    $col  = if ($ro) { 'Gray' } else { 'Green' }
    Write-Host ("[{0}] HWND=0x{1:X8} {2} rect={3}" -f $idx, $m.ToInt64(), $tag, $rect) -ForegroundColor $col
    Write-Host ("     texto atual: <<<{0}>>>" -f $txt) -ForegroundColor DarkGray
    $idx++
}
Write-Host "`n=== Fim (nada foi enviado ao bot). ===" -ForegroundColor Cyan
