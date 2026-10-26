import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createServiceControl } from "./index.ts";
import { fakeRunner } from "./test-support.ts";
import {
  createTaskArguments,
  powershellQuote,
  renderTaskCommand,
  renderWindowsLauncher,
  windowsLauncherPath,
} from "./windows-task.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentd-win-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const spec = (logFile: string) => ({
  label: "com.pptechs.agentd",
  execPath: "C:\\Program Files\\PP Agent\\PP Agent.exe",
  args: ["C:\\Program Files\\PP Agent\\resources\\daemon.mjs", "run", "it's"],
  env: {
    ELECTRON_RUN_AS_NODE: "1",
    PP_AGENT_HOME: "C:\\Users\\O'Neil\\AppData\\Roaming\\PP Agent",
  },
  logFile,
});

describe("windows task rendering", () => {
  it("quotes PowerShell literals", () => {
    expect(powershellQuote("it's")).toBe("'it''s'");
  });

  it("renders the launcher script", () => {
    const script = renderWindowsLauncher(spec("C:\\Users\\me\\logs\\daemon.log"));
    expect(script).toContain("$env:ELECTRON_RUN_AS_NODE = '1'\r\n");
    expect(script).toContain(
      "$env:PP_AGENT_HOME = 'C:\\Users\\O''Neil\\AppData\\Roaming\\PP Agent'",
    );
    expect(script).toContain(
      "$daemonArgs = @('C:\\Program Files\\PP Agent\\resources\\daemon.mjs', 'run', 'it''s')",
    );
    expect(script).toContain(
      "& 'C:\\Program Files\\PP Agent\\PP Agent.exe' @daemonArgs 2>&1 | Out-File -FilePath 'C:\\Users\\me\\logs\\daemon.log' -Append -Encoding utf8",
    );
  });

  it("renders a short hidden task command", () => {
    const command = renderTaskCommand("C:\\Users\\me\\PP Agent\\pp-agentd-launch.ps1");
    expect(command).toBe(
      'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\\Users\\me\\PP Agent\\pp-agentd-launch.ps1"',
    );
    expect(command.length).toBeLessThan(261);
    expect(createTaskArguments("PP Agent Daemon", "C:\\x.ps1").slice(0, 8)).toEqual([
      "/Create",
      "/SC",
      "ONLOGON",
      "/RL",
      "LIMITED",
      "/F",
      "/TN",
      "PP Agent Daemon",
    ]);
  });
});

describe("windows task service", () => {
  const make = (runner: ReturnType<typeof fakeRunner>["runner"]) =>
    createServiceControl({ ...spec(join(dir, "daemon.log")), platform: "win32", runner });

  it("installs: writes the launcher, creates and runs the task", async () => {
    const { runner, calls } = fakeRunner();
    await make(runner).install();
    const launcher = windowsLauncherPath(spec(join(dir, "daemon.log")));
    const content = await readFile(launcher, "utf8");
    expect(content.startsWith("\uFEFF")).toBe(true);
    expect(content).toContain("$env:ELECTRON_RUN_AS_NODE = '1'");
    expect(calls).toEqual([
      `schtasks ${createTaskArguments("PP Agent Daemon", launcher).join(" ")}`,
      "schtasks /Run /TN PP Agent Daemon",
    ]);
  });

  it("is idempotent", async () => {
    const { runner } = fakeRunner();
    await make(runner).install();
    await make(runner).install();
  });

  it("throws a readable error when the task cannot be created", async () => {
    const { runner } = fakeRunner((_file, args) =>
      args[0] === "/Create" ? { code: 1, stderr: "ERROR: Access is denied.\r\n" } : undefined,
    );
    await expect(make(runner).install()).rejects.toThrow(/could not register.*Access is denied/);
  });

  it("uninstalls: deletes the task and the launcher", async () => {
    const { runner, calls } = fakeRunner();
    const service = make(runner);
    await service.install();
    calls.length = 0;
    await service.uninstall();
    expect(calls).toEqual([
      "schtasks /Query /TN PP Agent Daemon",
      "schtasks /Delete /TN PP Agent Daemon /F",
    ]);
    const gone = await stat(windowsLauncherPath(spec(join(dir, "daemon.log")))).then(
      () => false,
      () => true,
    );
    expect(gone).toBe(true);
  });

  it("uninstall skips the delete when the task is absent", async () => {
    const { runner, calls } = fakeRunner((_file, args) =>
      args[0] === "/Query" ? { code: 1 } : undefined,
    );
    await make(runner).uninstall();
    expect(calls).toEqual(["schtasks /Query /TN PP Agent Daemon"]);
  });

  it("reports status from the query", async () => {
    let present = false;
    const { runner } = fakeRunner((_file, args) =>
      args[0] === "/Query" && !present
        ? { code: 1, stderr: "ERROR: The system cannot find the file" }
        : undefined,
    );
    const service = make(runner);
    expect(await service.status()).toEqual({
      supported: true,
      manager: "windows-task",
      installed: false,
      detail: null,
    });
    present = true;
    expect(await service.status()).toMatchObject({ installed: true });
  });
});
