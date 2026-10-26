import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { endpointFor, resolveDaemonPaths } from "./paths.ts";

const linux = { platform: "linux", uid: 1000 } as const;

describe("endpointFor", () => {
  it.each(["linux", "darwin"] as const)("uses home/run on %s", (platform) => {
    expect(endpointFor("/tmp/home", { platform, uid: 1000 })).toBe("/tmp/home/run/agentd.sock");
  });

  it("keeps the private temporary fallback for long Unix paths", () => {
    const home = `/${"x".repeat(83)}`;
    expect(endpointFor(home, linux)).toBe(join(home, "run", "agentd.sock"));
    expect(endpointFor(`${home}x`, linux)).toMatch(
      /^\/tmp\/pp-agent-1000\/agentd-[0-9a-f]{12}\.sock$/,
    );
  });

  it.each(["linux", "darwin"] as const)(
    "keeps long-home fallbacks stable, distinct and short on %s",
    (platform) => {
      const system = { platform, uid: 1000 };
      const home = `/${"x".repeat(200)}`;
      const endpoint = endpointFor(home, system);
      expect(endpoint).toBe(endpointFor(home, system));
      expect(endpoint).not.toBe(endpointFor(`${home}y`, system));
      expect(Buffer.byteLength(endpoint)).toBeLessThanOrEqual(100);
    },
  );

  it("keeps a stable, home-specific named pipe on Windows", () => {
    const windows = { platform: "win32", uid: 0 } as const;
    expect(endpointFor("C:\\home", windows)).toMatch(/^\\\\\.\\pipe\\pp-agentd-[0-9a-f]{12}$/);
    expect(endpointFor("C:\\home", windows)).not.toBe(endpointFor("C:\\other", windows));
  });
});

describe("resolveDaemonPaths workspace", () => {
  it("uses the Documents folder of the user by default", () => {
    const { agent } = resolveDaemonPaths({ PP_AGENT_HOME: "/tmp/home" }, linux);
    expect(agent.workspaceDir).toBe(join(homedir(), "Documents", "PP Agent"));
  });

  it("honors PP_AGENT_WORKSPACE", () => {
    const { agent } = resolveDaemonPaths(
      { PP_AGENT_HOME: "/tmp/home", PP_AGENT_WORKSPACE: "/data/Documents/PP Agent" },
      linux,
    );
    expect(agent.workspaceDir).toBe("/data/Documents/PP Agent");
  });
});
