# store-concierge-credential.ps1
# Guarda sua senha do b2click no Windows Credential Manager, de forma segura.
# VOCE digita a senha aqui; ela NUNCA aparece em log nem e vista por mais ninguem.
# O agente depois le essa credencial pra fazer login automatico no cold-start.
#
# Uso (rode no SEU terminal):
#   powershell -ExecutionPolicy Bypass -File .\automation\store-concierge-credential.ps1
#
# Para remover depois:  cmdkey /delete:b2click-concierge

$Target = "b2click-concierge"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Cred {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags; public uint Type; public string TargetName; public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize; public IntPtr CredentialBlob;
        public uint Persist; public uint AttributeCount; public IntPtr Attributes;
        public string TargetAlias; public string UserName;
    }
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool CredWrite(ref CREDENTIAL c, uint flags);
}
"@

$user = "JOAO.MOURA"
$sec  = Read-Host "Digite a senha do b2click para '$user'" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($sec)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringUni($bstr)
    $bytes = [System.Text.Encoding]::Unicode.GetBytes($plain)
    $blob  = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)

    $c = New-Object Cred+CREDENTIAL
    $c.Type = 1               # CRED_TYPE_GENERIC
    $c.TargetName = $Target
    $c.UserName = $user
    $c.CredentialBlob = $blob
    $c.CredentialBlobSize = $bytes.Length
    $c.Persist = 2            # CRED_PERSIST_LOCAL_MACHINE

    if ([Cred]::CredWrite([ref]$c, 0)) {
        Write-Host "OK: credencial '$Target' salva no Credential Manager para '$user'." -ForegroundColor Green
    } else {
        Write-Host ("FALHOU ao salvar (erro {0})." -f [Runtime.InteropServices.Marshal]::GetLastWin32Error()) -ForegroundColor Red
    }
    [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($bstr)
}
