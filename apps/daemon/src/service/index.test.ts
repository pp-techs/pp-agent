import { describe, expect, it } from "vite-plus/test";

import { createServiceControl } from "./index.ts";

describe("createServiceControl", () => {
  it("is unsupported on other platforms", async () => {
    const service = createServiceControl({
      execPath: "/bin/node",
      args: ["daemon.mjs", "run"],
      env: {},
      logFile: "/tmp/daemon.log",
      platform: "freebsd",
    });
    const status = await service.status();
    expect(status).toMatchObject({ supported: false, manager: null, installed: false });
    expect(status.detail).toMatch(/not supported on freebsd/);
    await expect(service.install()).rejects.toThrow(/not supported on freebsd/);
    await expect(service.uninstall()).rejects.toThrow(/not supported on freebsd/);
  });
});
