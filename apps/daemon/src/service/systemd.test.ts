import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createServiceControl } from "./index.ts";
import { fakeRunner } from "./test-support.ts";
import {
  quoteSystemdEnvironment,
  quoteSystemdWord,
  renderSystemdUnit,
  systemdUnitPath,
} from "./systemd.ts";

const label = "com.pptechs.agentd";
const spec = {
  label,
  execPath: "/opt/PP Agent/pp-agent",
  args: ["/opt/PP Agent/daemon.mjs", "run", 'say "hi" $HOME 100%'],
  env: { ELECTRON_RUN_AS_NODE: "1", PP_AGENT_HOME: "/home/me/PP Agent" },
  logFile: "/home/me/PP Agent/logs/daemon.log",
};

let home: string;
let real: typeof spec;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "agentd-systemd-"));
  real = { ...spec, logFile: join(home, "logs", "daemon.log") };
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const unitPath = () => systemdUnitPath(home, label);
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("systemd quoting", () => {
  it("quotes words and escapes quotes, backslashes, dollars and percents", () => {
    expect(quoteSystemdWord("/opt/PP Agent/x")).toBe('"/opt/PP Agent/x"');
    expect(quoteSystemdWord('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(quoteSystemdWord("$HOME 100%")).toBe('"$$HOME 100%%"');
    expect(quoteSystemdWord("line\nbreak")).toBe('"line\\nbreak"');
  });

  it("quotes environment assignments as one word", () => {
    expect(quoteSystemdEnvironment("A", "b c$d%")).toBe('"A=b c$d%%"');
  });
});

describe("renderSystemdUnit", () => {
  const unit = renderSystemdUnit(spec);
  it("renders the sections", () => {
    expect(unit).toContain(
      'ExecStart="/opt/PP Agent/pp-agent" "/opt/PP Agent/daemon.mjs" "run" "say \\"hi\\" $$HOME 100%%"',
    );
    expect(unit).toContain('Environment="ELECTRON_RUN_AS_NODE=1"');
    expect(unit).toContain('Environment="PP_AGENT_HOME=/home/me/PP Agent"');
    expect(unit).toContain("Restart=always\nRestartSec=10");
    expect(unit).toContain("StandardOutput=append:/home/me/PP Agent/logs/daemon.log");
    expect(unit).toContain("StandardError=append:/home/me/PP Agent/logs/daemon.log");
    expect(unit).toContain("[Install]\nWantedBy=default.target");
  });
});

describe("systemd service", () => {
  const options = (runner: ReturnType<typeof fakeRunner>["runner"]) =>
    createServiceControl({ ...real, platform: "linux", runner, homeDir: home, username: "me" });

  it("installs: writes the unit, reloads, enables and restarts", async () => {
    const { runner, calls } = fakeRunner();
    await options(runner).install();
    expect(await readFile(unitPath(), "utf8")).toBe(renderSystemdUnit(real));
    expect(calls).toEqual([
      "systemctl --user show-environment",
      "systemctl --user daemon-reload",
      "systemctl --user enable --now pp-agentd.service",
      "systemctl --user restart pp-agentd.service",
    ]);
  });

  it("is idempotent", async () => {
    const { runner } = fakeRunner();
    await options(runner).install();
    await options(runner).install();
    expect(await exists(unitPath())).toBe(true);
  });

  it("is unsupported without a user bus", async () => {
    const { runner } = fakeRunner((_file, args) =>
      args[1] === "show-environment"
        ? { code: 1, stderr: "Failed to connect to bus: No medium found" }
        : undefined,
    );
    const service = options(runner);
    const status = await service.status();
    expect(status.supported).toBe(false);
    expect(status.manager).toBe("systemd");
    expect(status.detail).toMatch(/not available here.*No medium found/);
    await expect(service.install()).rejects.toThrow(/not available here/);
    await expect(service.uninstall()).rejects.toThrow(/not available here/);
    expect(await exists(unitPath())).toBe(false);
  });

  it("is unsupported when systemctl is missing", async () => {
    const { runner } = fakeRunner(() => ({
      code: -1,
      notFound: true,
      stderr: "spawn systemctl ENOENT",
    }));
    expect((await options(runner).status()).detail).toMatch(/systemctl was not found/);
  });

  it("throws a readable error when enabling fails", async () => {
    const { runner } = fakeRunner((_file, args) =>
      args[1] === "enable" ? { code: 1, stderr: "Failed to enable unit" } : undefined,
    );
    await expect(options(runner).install()).rejects.toThrow(
      /could not enable.*Failed to enable unit/,
    );
  });

  it("uninstalls: disables, removes the unit and reloads", async () => {
    const { runner, calls } = fakeRunner();
    const service = options(runner);
    await service.install();
    calls.length = 0;
    await service.uninstall();
    expect(calls).toEqual([
      "systemctl --user show-environment",
      "systemctl --user disable --now pp-agentd.service",
      "systemctl --user daemon-reload",
    ]);
    expect(await exists(unitPath())).toBe(false);
  });

  it("uninstall without a unit does not disable", async () => {
    const { runner, calls } = fakeRunner();
    await options(runner).uninstall();
    expect(calls.some((call) => call.includes("disable"))).toBe(false);
  });

  it("reports installed with a linger hint when linger is off", async () => {
    let linger = "Linger=no\n";
    const { runner, calls } = fakeRunner((file) =>
      file === "loginctl" ? { stdout: linger } : undefined,
    );
    const service = options(runner);
    expect(await service.status()).toMatchObject({
      supported: true,
      installed: false,
      detail: null,
    });
    await mkdir(dirname(unitPath()), { recursive: true });
    await writeFile(unitPath(), "x");
    const status = await service.status();
    expect(status.installed).toBe(true);
    expect(status.detail).toMatch(/loginctl enable-linger/);
    expect(calls).toContain("loginctl show-user me -p Linger");
    linger = "Linger=yes\n";
    expect((await service.status()).detail).toBeNull();
  });

  it("reports a present but disabled unit as not installed", async () => {
    const { runner } = fakeRunner((_file, args) =>
      args[1] === "is-enabled" ? { code: 1, stdout: "disabled\n" } : undefined,
    );
    await mkdir(dirname(unitPath()), { recursive: true });
    await writeFile(unitPath(), "x");
    const status = await options(runner).status();
    expect(status.installed).toBe(false);
    expect(status.detail).toMatch(/not enabled/);
  });
});
