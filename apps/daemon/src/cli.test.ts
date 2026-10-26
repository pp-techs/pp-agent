import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ServiceControl } from "@workspace/agent-core";
import type { ServiceStatus } from "@workspace/shared";

import { runCli } from "./cli.ts";

let out: string;
let err: string;

beforeEach(() => {
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function fakeService(overrides: Partial<ServiceControl> = {}, status?: Partial<ServiceStatus>) {
  const calls: string[] = [];
  const service: ServiceControl = {
    async status() {
      calls.push("status");
      return { supported: true, manager: "launchd", installed: true, detail: null, ...status };
    },
    async install() {
      calls.push("install");
    },
    async uninstall() {
      calls.push("uninstall");
    },
    ...overrides,
  };
  return { service, calls };
}

describe("runCli", () => {
  it("prints usage for help", async () => {
    for (const arg of ["help", "--help"]) {
      out = "";
      expect(await runCli([arg], fakeService().service)).toBe(0);
      expect(out).toContain("pp-agentd");
      for (const command of ["run", "install", "uninstall", "status"])
        expect(out).toContain(command);
    }
  });

  it("installs and shows the status detail", async () => {
    const { service, calls } = fakeService({}, { detail: "Run `loginctl enable-linger`." });
    expect(await runCli(["install"], service)).toBe(0);
    expect(calls).toEqual(["install", "status"]);
    expect(out).toContain("installed");
    expect(out).toContain("enable-linger");
  });

  it("reports install failures", async () => {
    const { service } = fakeService({
      async install() {
        throw new Error("launchd said no");
      },
    });
    expect(await runCli(["install"], service)).toBe(1);
    expect(err).toContain("launchd said no");
  });

  it("uninstalls and reports failures", async () => {
    const ok = fakeService();
    expect(await runCli(["uninstall"], ok.service)).toBe(0);
    expect(ok.calls).toEqual(["uninstall"]);
    const bad = fakeService({
      async uninstall() {
        throw new Error("nope");
      },
    });
    expect(await runCli(["uninstall"], bad.service)).toBe(1);
    expect(err).toContain("nope");
  });

  it("prints status and exits by installed state", async () => {
    expect(await runCli(["status"], fakeService().service)).toBe(0);
    expect(out).toContain("Service manager: launchd");
    expect(out).toContain("Installed: yes");
    out = "";
    const missing = fakeService(
      {},
      { supported: false, manager: null, installed: false, detail: "Nope." },
    );
    expect(await runCli(["status"], missing.service)).toBe(1);
    expect(out).toContain("Supported: no");
    expect(out).toContain("Nope.");
  });

  it("rejects unknown commands", async () => {
    expect(await runCli(["frobnicate"], fakeService().service)).toBe(2);
    expect(err).toContain('Unknown command "frobnicate"');
    err = "";
    expect(await runCli([], fakeService().service)).toBe(2);
    expect(err).toContain("Usage: pp-agentd");
  });
});
