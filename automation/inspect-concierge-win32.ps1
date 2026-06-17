# inspect-concierge-win32.ps1  (v2 - usa EnumWindows, sem match exato)
# Rode com o CONCIERGE ABERTO (embutido na janela REDESOFT).
# Acha a janela principal varrendo TODAS as janelas de topo, depois
# enumera os HWND filhos (controles Delphi reais: TMemo, TEdit, TStringGrid...).

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class Win32Enum {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern bool EnumChildWindows(IntPtr hWndParent, EnumProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    static string Cls(IntPtr h){ var s=new StringBuilder(256); GetClassName(h,s,s.Capacity); return s.ToString(); }
    static string Txt(IntPtr h){
        int len=GetWindowTextLength(h); if(len<=0) return "";
        var s=new StringBuilder(len+1); GetWindowText(h,s,s.Capacity);
        return s.ToString().Replace("\r"," ").Replace("\n"," ");
    }
    static string RectStr(IntPtr h){ RECT r; GetWindowRect(h,out r);
        return string.Format("({0},{1} {2}x{3})", r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top); }

    // Lista janelas de topo (so visiveis com titulo) -> "HWND|class|title|pid"
    public static List<string> TopWindows() {
        var outp = new List<string>();
        EnumProc cb = (h,l) => {
            if(!IsWindowVisible(h)) return true;
            string t=Txt(h); string c=Cls(h);
            if(t.Length==0 && c.Length==0) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            outp.Add(string.Format("0x{0:X8}|{1}|{2}|{3}", h.ToInt64(), c, t, pid));
            return true;
        };
        EnumWindows(cb, IntPtr.Zero);
        return outp;
    }

    public static IntPtr FindByClassContains(string frag) {
        IntPtr found = IntPtr.Zero;
        EnumProc cb = (h,l) => {
            if(Cls(h).IndexOf(frag, StringComparison.OrdinalIgnoreCase) >= 0){ found=h; return false; }
            return true;
        };
        EnumWindows(cb, IntPtr.Zero);
        return found;
    }

    public static List<string> Children(IntPtr parent) {
        var lines = new List<string>();
        EnumProc cb = (h, l) => {
            string c=Cls(h); string t=Txt(h);
            if(t.Length>70) t=t.Substring(0,70)+"...";
            string vis = IsWindowVisible(h) ? "vis" : "hid";
            lines.Add(string.Format("HWND=0x{0:X8} [{1}] class='{2}' text='{3}' rect={4}",
                h.ToInt64(), vis, c, t, RectStr(h)));
            return true;
        };
        EnumChildWindows(parent, cb, IntPtr.Zero);
        return lines;
    }
}
"@

Write-Host "`n=== Todas as janelas de topo (visiveis, com titulo/classe) ===" -ForegroundColor Cyan
foreach ($w in [Win32Enum]::TopWindows()) {
    $p = $w.Split('|')
    Write-Host ("  HWND={0}  class='{1}'  title='{2}'  pid={3}" -f $p[0], $p[1], $p[2], $p[3])
}

# mira na janela do CONCIERGE (janela Win32 propria: TFrm_Concierge)
$main = [Win32Enum]::FindByClassContains("TFrm_Concierge")
if ($main -eq [IntPtr]::Zero) { $main = [Win32Enum]::FindByClassContains("Concierge") }

if ($main -eq [IntPtr]::Zero) {
    Write-Host "`n[!] Nao achei a janela do Concierge (TFrm_Concierge). Ela esta aberta?" -ForegroundColor Yellow
    return
}

Write-Host ("`n=== Filhos da janela CONCIERGE (HWND=0x{0:X8}) ===" -f $main.ToInt64()) -ForegroundColor Cyan
$lines = [Win32Enum]::Children($main)
Write-Host ("Total de controles filhos: {0}`n" -f $lines.Count)

Write-Host "--- CANDIDATOS (campo de chat e grade de tarefas) ---" -ForegroundColor Green
$cand = $lines | Where-Object { $_ -match "class='T(Memo|RichEdit|Edit|StringGrid|ListView|cxGrid|DBGrid|cxMemo|cxTextEdit|cxRichEdit)" }
if ($cand) { $cand | ForEach-Object { Write-Host $_ } } else { Write-Host "  (nenhum controle editavel/grade encontrado entre os filhos)" -ForegroundColor Yellow }

Write-Host "`n--- TODOS os controles filhos ---" -ForegroundColor DarkGray
$lines | ForEach-Object { Write-Host $_ }

Write-Host "`n=== Fim. Cole a saida. ===" -ForegroundColor Cyan
