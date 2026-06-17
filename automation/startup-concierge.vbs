' startup-concierge.vbs
' Roda concierge-login.ps1 silenciosamente (sem janela) ao iniciar o Windows.
' Coloque este arquivo em:
'   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\
' (o install-startup.ps1 faz isso automaticamente)

Dim sh, ps1
Set sh = CreateObject("WScript.Shell")

' Pasta do VBS -> pasta automation -> script
Dim vbsDir
vbsDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
ps1 = vbsDir & "concierge-login.ps1"

sh.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
