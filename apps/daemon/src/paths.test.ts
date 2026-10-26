import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolveDaemonPaths } from "./paths.ts";

const linux = { platform: "linux", uid: 1000 } as const;

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
