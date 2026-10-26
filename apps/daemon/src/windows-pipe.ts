import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * libuv creates every named-pipe instance with the process token's default DACL. Set that DACL
 * before listening so there is no publicly accessible instance, including replacement instances.
 * Node has no pipe-security API; readableAll/writableAll only GRANT access to Everyone.
 */
export async function restrictWindowsPipeAccess(): Promise<void> {
  if (process.platform !== "win32") return;
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PipeTokenSecurity {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool SetTokenInformation(IntPtr token, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$processHandle = [PipeTokenSecurity]::OpenProcess(0x1000, $false, ${process.pid})
$token = [IntPtr]::Zero
$aclMemory = [IntPtr]::Zero
$info = [IntPtr]::Zero
try {
  if ($processHandle -eq [IntPtr]::Zero) { throw 'Cannot open daemon process for pipe security.' }
  if (-not [PipeTokenSecurity]::OpenProcessToken($processHandle, 0x88, [ref]$token)) { throw 'Cannot open daemon token for pipe security.' }
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $descriptor = New-Object System.Security.AccessControl.RawSecurityDescriptor("D:P(A;;GA;;;SY)(A;;GA;;;$sid)")
  $acl = New-Object byte[] $descriptor.DiscretionaryAcl.BinaryLength
  $descriptor.DiscretionaryAcl.GetBinaryForm($acl, 0)
  $aclMemory = [Runtime.InteropServices.Marshal]::AllocHGlobal($acl.Length)
  [Runtime.InteropServices.Marshal]::Copy($acl, 0, $aclMemory, $acl.Length)
  $info = [Runtime.InteropServices.Marshal]::AllocHGlobal([IntPtr]::Size)
  [Runtime.InteropServices.Marshal]::WriteIntPtr($info, $aclMemory)
  if (-not [PipeTokenSecurity]::SetTokenInformation($token, 6, $info, [IntPtr]::Size)) { throw 'Cannot restrict daemon pipe access.' }
} finally {
  if ($info -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($info) }
  if ($aclMemory -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($aclMemory) }
  if ($token -ne [IntPtr]::Zero) { [void][PipeTokenSecurity]::CloseHandle($token) }
  if ($processHandle -ne [IntPtr]::Zero) { [void][PipeTokenSecurity]::CloseHandle($processHandle) }
}
`;
  await promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { windowsHide: true, timeout: 15_000 },
  );
}
