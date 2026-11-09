import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  applyDroppedConfig,
  CONFIG_DROP_FILE,
  exportConfigBundle,
  mergeConfigBundle,
  parseConfigBundle,
} from "./config-bundle.ts";
import { McpConfigFile } from "./mcp.ts";
import { SettingsStore } from "./settings-store.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pp-config-bundle-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const gateway = (id: string, name: string) => ({
  id,
  name,
  api: "openai-completions" as const,
  baseUrl: "https://example.com/v1",
  requiresApiKey: true,
  models: [{ id: "m1", name: "Model 1" }],
});

const agent = (name: string) => ({
  name,
  icon: "🧩",
  description: `About ${name}`,
  instructions: "Be brief.",
  tools: ["read"],
  mcpServers: null,
  skills: null,
  model: null,
  starterPrompts: ["Hello"],
  memory: true,
});

function store() {
  return new SettingsStore(join(dir, "settings.json"));
}

function mcpConfig() {
  return new McpConfigFile(join(dir, "agent", "mcp.json"));
}

describe("parseConfigBundle", () => {
  it("rejects a file that is not a configuration bundle", () => {
    expect(() => parseConfigBundle("{")).toThrow();
    expect(() => parseConfigBundle("[]")).toThrow();
    expect(() => parseConfigBundle(JSON.stringify({ ppAgentExport: 1, agent: {} }))).toThrow();
    expect(() => parseConfigBundle(JSON.stringify({ ppAgentConfig: 1 }))).toThrow();
  });

  it("keeps the fields it can read and leaves the malformed ones out", () => {
    const bundle = parseConfigBundle(
      JSON.stringify({
        ppAgentConfig: 1,
        config: {
          gateways: [gateway("gw-1", "Work"), { id: "gw-2" }],
          agents: [agent("Finance"), { description: "no name" }],
          mcpServers: { "srv-1": { command: "npx" }, bad: "text" },
          toolPolicies: { read: "allow", write: "sideways" },
          shellEnabled: "yes",
          yoloMode: true,
          language: "vi",
          defaultModel: { provider: "gw-1", modelId: "m1" },
          fastModel: { provider: 3 },
          disabledSkills: ["a", 2, "b", "a"],
        },
      }),
    );
    expect(bundle.gateways?.map((entry) => entry.id)).toEqual(["gw-1"]);
    expect(bundle.agents?.map((entry) => entry.name)).toEqual(["Finance"]);
    expect(Object.keys(bundle.mcpServers ?? {})).toEqual(["srv-1"]);
    expect(bundle.toolPolicies).toEqual({ read: "allow" });
    expect(bundle.shellEnabled).toBeUndefined();
    expect(bundle.yoloMode).toBe(true);
    expect(bundle.language).toBe("vi");
    expect(bundle.defaultModel).toEqual({ provider: "gw-1", modelId: "m1" });
    expect(bundle.fastModel).toBeUndefined();
    expect(bundle.disabledSkills).toEqual(["a", "b"]);
  });

  it("leaves fields it does not carry undefined", () => {
    const bundle = parseConfigBundle(JSON.stringify({ ppAgentConfig: 1, config: {} }));
    expect(bundle.defaultModel).toBeUndefined();
    expect(bundle.shellEnabled).toBeUndefined();
    expect(bundle.disabledSkills).toBeUndefined();
  });
});

describe("mergeConfigBundle", () => {
  it("applies what the bundle carries and leaves the rest alone", () => {
    const settings = store();
    settings.update((draft) => {
      draft.shellEnabled = true;
      draft.gateways.push(gateway("gw-old", "Old"));
    });
    const draft = structuredClone(settings.get());
    const report = mergeConfigBundle(draft, {
      gateways: [gateway("gw-1", "Work")],
      agents: [agent("Finance")],
      toolPolicies: { read: "allow" },
      language: "vi",
    });
    expect(draft.shellEnabled).toBe(true);
    expect(draft.language).toBe("vi");
    expect(draft.toolPolicies).toEqual({ read: "allow" });
    expect(draft.gateways.map((entry) => entry.id)).toEqual(["gw-old", "gw-1"]);
    expect(draft.agents.map((entry) => entry.name)).toEqual(["PP Agent", "Finance"]);
    expect(report).toEqual({
      gateways: 1,
      agents: 1,
      mcpServers: 0,
      toolPolicies: 1,
      settings: 1,
      disabledSkills: 0,
      trustedSkillFolders: 0,
    });
  });

  it("changes nothing new when the same bundle is applied again", () => {
    const settings = store();
    const bundle = parseConfigBundle(
      JSON.stringify({
        ppAgentConfig: 1,
        config: {
          gateways: [gateway("gw-1", "Work")],
          agents: [agent("Finance")],
          toolPolicies: { read: "allow" },
          disabledSkills: ["skill-a"],
        },
      }),
    );
    settings.update((draft) => {
      mergeConfigBundle(draft, bundle);
    });
    const once = settings.get();
    settings.update((draft) => {
      mergeConfigBundle(draft, bundle);
    });
    expect(settings.get()).toEqual(once);
  });

  it("merges agents by name and keeps their local id", () => {
    const settings = store();
    settings.update((draft) => {
      draft.agents.push({ ...agent("Finance"), id: "ag-local" });
    });
    settings.update((draft) => {
      mergeConfigBundle(draft, { agents: [agent("finance")] });
    });
    const [finance] = settings.get().agents.filter((entry) => entry.id === "ag-local");
    expect(finance.description).toBe("About finance");
    expect(settings.get().agents.map((entry) => entry.id)).not.toContain("ag-finance");
  });

  it("merges gateways by id so a saved key keeps working", () => {
    const settings = store();
    settings.update((draft) => {
      draft.gateways.push(gateway("gw-1", "Old name"));
    });
    settings.update((draft) => {
      mergeConfigBundle(draft, { gateways: [gateway("gw-1", "New name")] });
    });
    const gateways = settings.get().gateways;
    expect(gateways).toHaveLength(1);
    expect(gateways[0].name).toBe("New name");
  });

  it("merges tool policies per tool and replaces the skill lists", () => {
    const settings = store();
    settings.update((draft) => {
      draft.toolPolicies = { read: "off", grep: "ask" };
      draft.disabledSkills = ["keep-me"];
    });
    settings.update((draft) => {
      mergeConfigBundle(draft, {
        toolPolicies: { read: "allow" },
        disabledSkills: ["skill-a"],
        trustedSkillFolders: ["/tmp/skills", "relative"],
      });
    });
    const after = settings.get();
    expect(after.toolPolicies).toEqual({ read: "allow", grep: "ask" });
    expect(after.disabledSkills).toEqual(["skill-a"]);
    expect(after.trustedSkillFolders).toEqual(["/tmp/skills"]);
  });
});

describe("exportConfigBundle", () => {
  it("round-trips the setup without machine-specific ids or secrets", () => {
    const settings = store();
    settings.update((draft) => {
      draft.gateways.push(gateway("gw-1", "Work"));
      draft.agents.push({ ...agent("Finance"), id: "ag-local" });
      draft.toolPolicies = { read: "allow" };
    });
    const config = mcpConfig();
    mkdirSync(join(dir, "agent"), { recursive: true });
    writeFileSync(config.path, JSON.stringify({ mcpServers: { "srv-1": { command: "npx" } } }), {
      mode: 0o600,
    });
    const bundle = parseConfigBundle(exportConfigBundle(settings.get(), config.servers()));
    expect(bundle.gateways?.map((entry) => entry.id)).toEqual(["gw-1"]);
    expect(bundle.gateways?.[0].requiresApiKey).toBe(true);
    expect(bundle.agents?.map((entry) => entry.name)).toEqual(["PP Agent", "Finance"]);
    expect(bundle.mcpServers).toEqual({ "srv-1": { command: "npx" } });
    expect(bundle.toolPolicies).toEqual({ read: "allow" });
  });
});

describe("applyDroppedConfig", () => {
  it("does nothing without a dropped file", () => {
    const messages: string[] = [];
    expect(
      applyDroppedConfig(store(), mcpConfig(), dir, (message) => messages.push(message)),
    ).toBeNull();
    expect(messages).toEqual([]);
  });

  it("applies the dropped bundle and removes the file", () => {
    writeFileSync(
      join(dir, CONFIG_DROP_FILE),
      JSON.stringify({
        ppAgentConfig: 1,
        config: {
          agents: [agent("Finance")],
          mcpServers: { "srv-1": { command: "npx" } },
        },
      }),
    );
    const messages: string[] = [];
    const report = applyDroppedConfig(store(), mcpConfig(), dir, (message) =>
      messages.push(message),
    );
    expect(report?.agents).toBe(1);
    expect(report?.mcpServers).toBe(1);
    expect(messages).toEqual([]);
    expect(existsSync(join(dir, CONFIG_DROP_FILE))).toBe(false);
    expect(
      store()
        .get()
        .agents.map((entry) => entry.name),
    ).toContain("Finance");
    expect(JSON.parse(readFileSync(mcpConfig().path, "utf8")).mcpServers).toEqual({
      "srv-1": { command: "npx" },
    });
  });

  it("keeps a broken bundle aside and reports it", () => {
    const path = join(dir, CONFIG_DROP_FILE);
    writeFileSync(path, "{ not json");
    const settings = store();
    const before = settings.get();
    const messages: string[] = [];
    expect(
      applyDroppedConfig(settings, mcpConfig(), dir, (message) => messages.push(message)),
    ).toBeNull();
    expect(messages).toHaveLength(1);
    expect(existsSync(`${path}.failed`)).toBe(true);
    expect(settings.get()).toEqual(before);
  });
});

describe("McpConfigFile.mergeServers", () => {
  it("replaces same-named servers and keeps the file's other keys", () => {
    const config = mcpConfig();
    mkdirSync(join(dir, "agent"), { recursive: true });
    writeFileSync(
      config.path,
      JSON.stringify({
        otherTopLevel: true,
        mcpServers: {
          "srv-1": { command: "old" },
          "srv-2": { command: "keep" },
        },
      }),
      { mode: 0o600 },
    );
    expect(
      config.mergeServers({ "srv-1": { command: "new" }, "srv-3": { command: "add" }, bad: 3 }),
    ).toBe(2);
    expect(JSON.parse(readFileSync(config.path, "utf8"))).toEqual({
      otherTopLevel: true,
      mcpServers: {
        "srv-1": { command: "new" },
        "srv-2": { command: "keep" },
        "srv-3": { command: "add" },
      },
    });
    expect(config.mergeServers(undefined)).toBe(0);
  });
});
