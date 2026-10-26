import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vite-plus/test";
import { DaemonServer } from "./server.ts";

// Exercise native pipe ACLs when the suite runs on Windows, including a replacement instance.
it.skipIf(process.platform !== "win32")(
  "restricts every pipe instance to the owner and SYSTEM",
  async () => {
    const name = `pp-agentd-acl-test-${process.pid}`;
    const server = new DaemonServer({
      endpoint: `\\\\.\\pipe\\${name}`,
      token: "a".repeat(64),
      appVersion: "test",
      onShutdown() {},
    });
    try {
      expect(await server.listen()).toBe("listening");
      const script = `
$ErrorActionPreference = 'Stop'
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
for ($i = 0; $i -lt 2; $i++) {
  $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', '${name}', [System.IO.Pipes.PipeDirection]::InOut)
  try {
    $pipe.Connect(5000)
    $rules = $pipe.GetAccessControl().GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    if ($rules.Count -eq 0) { throw 'The pipe has no access rules.' }
    foreach ($rule in $rules) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($owner, 'S-1-5-18')) {
        throw 'Unexpected principal has pipe access.'
      }
    }
  } finally { $pipe.Dispose() }
}
`;
      await expect(
        promisify(execFile)(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(script, "utf16le").toString("base64"),
          ],
          { timeout: 15_000 },
        ),
      ).resolves.toBeDefined();
    } finally {
      await server.close();
    }
  },
  30_000,
);
