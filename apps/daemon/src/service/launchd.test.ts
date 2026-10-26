import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createServiceControl } from "./index.ts";
import { launchdPlistPath, renderLaunchdPlist } from "./launchd.ts";
import { fakeRunner } from "./test-support.ts";

const label = "com.pptechs.agentd";
const spec = {
  label,
  execPath: "/Applications/PP Agent.app/Contents/MacOS/PP Agent",
  args: ["/Applications/PP Agent.app/Contents/Resources/daemon.mjs", "run"],
  env: { ELECTRON_RUN_AS_NODE: "1", PP_AGENT_HOME: "/Users/a&b/Library/Application Support/<PP>" },
  logFile: "/Users/a&b/logs/daemon.log",
};

let home: string;
let real: typeof spec;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "agentd-launchd-"));
  real = { ...spec, logFile: join(home, "logs", "daemon.log") };
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe("renderLaunchdPlist", () => {
  const plist = renderLaunchdPlist(spec);

  it("escapes paths with spaces, ampersands and angle brackets", () => {
    expect(plist).toContain("<string>/Applications/PP Agent.app/Contents/MacOS/PP Agent</string>");
    expect(plist).toContain("/Users/a&amp;b/Library/Application Support/&lt;PP&gt;");
    expect(plist).toContain("<string>/Users/a&amp;b/logs/daemon.log</string>");
    expect(plist).not.toContain("a&b");
  });

  it("describes the job", () => {
    expect(plist).toContain(`<key>Label</key>\n  <string>${label}</string>`);
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain("<key>ThrottleInterval</key>\n  <integer>10</integer>");
    expect(plist).toContain("<key>ProcessType</key>\n  <string>Background</string>");
    expect(plist).toContain("<key>StandardErrorPath</key>");
    expect(plist.indexOf("PP Agent</string>")).toBeLessThan(plist.indexOf("daemon.mjs</string>"));
  });
});

describe("launchd service", () => {
  const plistPath = () => launchdPlistPath(home, label);

  it("installs: writes the plist, boots out, bootstraps and kickstarts", async () => {
    const { runner, calls } = fakeRunner((_file, args) =>
      args[0] === "bootout" ? { code: 113, stderr: "Could not find service" } : undefined,
    );
    const service = createServiceControl({
      ...real,
      platform: "darwin",
      runner,
      homeDir: home,
      uid: 501,
    });
    await service.install();
    expect(await readFile(plistPath(), "utf8")).toBe(renderLaunchdPlist(real));
    expect(calls).toEqual([
      `launchctl bootout gui/501/${label}`,
      `launchctl bootstrap gui/501 ${plistPath()}`,
      `launchctl kickstart -k gui/501/${label}`,
    ]);
  });

  it("is idempotent and rewrites the plist with the current command", async () => {
    const { runner } = fakeRunner();
    const first = createServiceControl({
      ...real,
      platform: "darwin",
      runner,
      homeDir: home,
      uid: 501,
    });
    await first.install();
    const moved = { ...real, execPath: "/usr/local/bin/node" };
    await createServiceControl({
      ...moved,
      platform: "darwin",
      runner,
      homeDir: home,
      uid: 501,
    }).install();
    expect(await readFile(plistPath(), "utf8")).toContain("<string>/usr/local/bin/node</string>");
  });

  it("throws a readable error when bootstrap fails", async () => {
    const { runner } = fakeRunner((_file, args) =>
      args[0] === "bootstrap"
        ? { code: 5, stderr: "Bootstrap failed: 5: Input/output error\n" }
        : undefined,
    );
    const service = createServiceControl({
      ...real,
      platform: "darwin",
      runner,
      homeDir: home,
      uid: 501,
    });
    await expect(service.install()).rejects.toThrow(/could not load.*Input\/output error/);
  });

  it("uninstalls: boots out and removes the plist", async () => {
    const { runner, calls } = fakeRunner();
    const service = createServiceControl({
      ...real,
      platform: "darwin",
      runner,
      homeDir: home,
      uid: 501,
    });
    await service.install();
    calls.length = 0;
    await service.uninstall();
    expect(calls).toEqual([`launchctl bootout gui/501/${label}`]);
    expect(await exists(plistPath())).toBe(false);
    await service.uninstall();
  });

  it("reports status from the plist and the loaded job", async () => {
    let loaded = true;
    const { runner } = fakeRunner((_file, args) =>
      args[0] === "print" && !loaded ? { code: 113, stderr: "Could not find service" } : undefined,
    );
    const service = createServiceControl({
      ...real,
      platform: "darwin",
      runner,
      homeDir: home,
      uid: 501,
    });
    expect(await service.status()).toEqual({
      supported: true,
      manager: "launchd",
      installed: false,
      detail: null,
    });
    await service.install();
    expect(await service.status()).toMatchObject({ installed: true, detail: null });
    loaded = false;
    const status = await service.status();
    expect(status.installed).toBe(false);
    expect(status.detail).toMatch(/not loaded: Could not find service/);
  });

  it("fails install readably without a user id", async () => {
    const { runner } = fakeRunner();
    const service = createServiceControl({
      ...real,
      platform: "darwin",
      runner,
      homeDir: home,
      uid: null,
    });
    await service.install().then(
      () => expect.unreachable(),
      (error: Error) => expect(error.message).toMatch(/user id/),
    );
  });
});
