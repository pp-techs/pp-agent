import {
  COMPUTER_READ_ACTIONS,
  type ComputerApp,
  type ComputerRequest,
  type ComputerResult,
  isProtectedComputerApp,
} from "@workspace/shared";
import type { McpToolResult } from "./mcp-client.ts";

/** One cua-driver tool call; rejects only when the driver cannot be reached. */
export type DriverCall = (
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<McpToolResult>;

/** Longest screen text one step returns; the model narrows a snapshot with `query`. */
const MAX_TEXT = 25_000;
/** Long edge of the screenshots the model gets, in pixels. */
const MAX_IMAGE = 1280;
const TOKEN = /^(s[0-9a-f]{8}):\d+$/;

interface DriverApp {
  name?: string;
  pid?: number;
  bundle_id?: string;
  launch_path?: string;
  running?: boolean;
}

interface DriverWindow {
  window_id: number;
  pid: number;
  title?: string;
  layer?: number;
  z_index?: number | null;
  is_on_screen?: boolean;
}

interface Target {
  app: ComputerApp;
  pid: number;
}

/** The id the agent uses for an app: its bundle id where it has one. */
function appId(app: DriverApp): string | null {
  return app.bundle_id ?? app.launch_path ?? app.name ?? null;
}

function textOf(result: McpToolResult): string {
  return result.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

function clip(text: string): string {
  return text.length > MAX_TEXT
    ? `${text.slice(0, MAX_TEXT)}\n… (cut; take a snapshot with query to see a part)`
    : text;
}

/**
 * Runs the agent's `computer` tool calls on cua-driver. The app the call names is looked up again
 * on every call, so a call can only reach that app's own windows: protected apps are refused, a
 * window must belong to the app's process, and an element token must come from a snapshot this
 * class took of that process. Steps that change something return what changed in the window.
 */
export class ComputerAutomation {
  /** Snapshot id → the window it was taken of; tokens carry the snapshot id. */
  private readonly snapshots = new Map<string, { pid: number; window: number }>();

  constructor(
    private readonly call: DriverCall,
    /** PIDs of PP Agent itself, which the agent may never drive. */
    private readonly ownPids: () => readonly number[],
  ) {}

  async run(request: ComputerRequest, signal?: AbortSignal): Promise<ComputerResult> {
    if (request.action === "apps") return this.apps(signal);
    const target = await this.target(request.app, signal);
    if (request.action === "launch") return this.launch(target, signal);
    if (!target.pid) throw new Error(`${target.app.name} is not running; launch it first.`);
    if (request.action === "windows") return this.windows(target, signal);
    const window = await this.window(target, request, signal);
    if (request.action === "snapshot") return this.snapshot(target, window, request, signal);
    if (request.action === "screenshot") return this.screenshot(target, window, signal);
    const [tool, args] = this.action(target, window, request);
    const done = await this.tool(tool, args, signal);
    // What changed since the last snapshot of the window, as the model's check of the step.
    const after = await this.tool(
      "get_window_state",
      { pid: target.pid, window_id: window, since: "latest", include_screenshot: false },
      signal,
    ).catch((error: unknown) => ({
      text: `(Could not read the window afterwards: ${error instanceof Error ? error.message : String(error)})`,
      structured: undefined,
    }));
    this.remember(after.structured, target.pid, window);
    return { text: clip([done.text || "Done.", after.text].filter(Boolean).join("\n\n")) };
  }

  /** Calls a driver tool; a refusal or failure becomes an error the model reads. */
  private async tool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{
    text: string;
    structured?: Record<string, unknown>;
    image?: McpToolResult["content"][number];
  }> {
    const result = await this.call(name, args, signal);
    const text = textOf(result);
    if (result.isError) throw new Error(text || `${name} failed.`);
    const image = result.content.find((part) => part.type === "image");
    return { text, structured: result.structuredContent, image };
  }

  private async listApps(signal?: AbortSignal): Promise<DriverApp[]> {
    const { structured } = await this.tool("list_apps", {}, signal);
    const apps = structured?.apps;
    return Array.isArray(apps) ? (apps as DriverApp[]) : [];
  }

  private usable(app: DriverApp): ComputerApp | null {
    const id = appId(app);
    if (!id) return null;
    const entry = { id, name: app.name ?? id };
    if (isProtectedComputerApp(entry)) return null;
    if (app.pid && this.ownPids().includes(app.pid)) return null;
    return entry;
  }

  private async apps(signal?: AbortSignal): Promise<ComputerResult> {
    const running: string[] = [];
    const installed: string[] = [];
    const seen: ComputerApp[] = [];
    for (const app of await this.listApps(signal)) {
      const entry = this.usable(app);
      if (!entry || seen.some((other) => other.id === entry.id)) continue;
      seen.push(entry);
      (app.running ? running : installed).push(`- ${entry.name} (${entry.id})`);
    }
    const text = [
      `Running apps:\n${running.join("\n") || "- none"}`,
      `Installed, not running:\n${installed.join("\n") || "- none"}`,
      "Apps PP Agent may not use (PP Agent, terminals, password and system settings apps) are left out.",
    ].join("\n\n");
    return { text: clip(text), apps: seen };
  }

  private async target(id: string | undefined, signal?: AbortSignal): Promise<Target> {
    const wanted = id?.trim();
    if (!wanted) throw new Error("This action needs app: call apps first and pass the app's id.");
    const matches = (await this.listApps(signal)).filter((app) => appId(app) === wanted);
    const match = matches.find((app) => app.running && app.pid) ?? matches[0];
    if (!match) throw new Error(`No app has the id ${wanted}; call apps to see the ids.`);
    const app = this.usable(match);
    if (!app) throw new Error(`${match.name ?? wanted} cannot be used by the agent.`);
    return { app, pid: match.running ? (match.pid ?? 0) : 0 };
  }

  private async launch(target: Target, signal?: AbortSignal): Promise<ComputerResult> {
    const args = target.app.id.includes("/")
      ? { name: target.app.id }
      : { bundle_id: target.app.id };
    const { text } = await this.tool("launch_app", args, signal);
    return { text: clip(text || `Opened ${target.app.name}.`), apps: [target.app] };
  }

  private async listWindows(pid: number, signal?: AbortSignal): Promise<DriverWindow[]> {
    const { structured } = await this.tool("list_windows", { pid }, signal);
    const windows = structured?.windows;
    return (Array.isArray(windows) ? (windows as DriverWindow[]) : []).filter(
      (window) => window.pid === pid && (window.layer ?? 0) === 0,
    );
  }

  private async windows(target: Target, signal?: AbortSignal): Promise<ComputerResult> {
    const windows = await this.listWindows(target.pid, signal);
    const lines = windows.map(
      (window) =>
        `- window ${window.window_id}: ${window.title || "(untitled)"}${window.is_on_screen === false ? " (hidden or minimized)" : ""}`,
    );
    return {
      text: `${target.app.name} windows:\n${lines.join("\n") || "- none open"}`,
    };
  }

  /** The window the call names (it must be the app's), or the app's front window. */
  private async window(
    target: Target,
    request: ComputerRequest,
    signal?: AbortSignal,
  ): Promise<number> {
    const fromRef = this.refWindow(target, request.ref);
    if (fromRef !== null) return fromRef;
    const windows = await this.listWindows(target.pid, signal);
    if (request.window !== undefined) {
      if (!windows.some((window) => window.window_id === request.window))
        throw new Error(
          `Window ${request.window} is not a window of ${target.app.name}; call windows.`,
        );
      return request.window;
    }
    const front = windows.reduce<DriverWindow | null>(
      (best, window) =>
        best === null || (window.z_index ?? -Infinity) > (best.z_index ?? -Infinity)
          ? window
          : best,
      null,
    );
    if (!front) throw new Error(`${target.app.name} has no open window.`);
    return front.window_id;
  }

  /** The window of the snapshot a ref comes from; refs from another app's window are refused. */
  private refWindow(target: Target, ref: string | undefined): number | null {
    if (ref === undefined) return null;
    const snapshot = TOKEN.exec(ref.trim())?.[1];
    const window = snapshot ? this.snapshots.get(snapshot) : undefined;
    if (!window || window.pid !== target.pid)
      throw new Error(
        `${ref} is not from a snapshot of ${target.app.name}; take a snapshot and use its refs.`,
      );
    return window.window;
  }

  private remember(structured: Record<string, unknown> | undefined, pid: number, window: number) {
    const id = structured?.snapshot_id;
    if (typeof id === "string") this.snapshots.set(id, { pid, window });
    for (const old of Array.isArray(structured?.invalidated_snapshot_ids)
      ? structured.invalidated_snapshot_ids
      : [])
      this.snapshots.delete(String(old));
  }

  private async snapshot(
    target: Target,
    window: number,
    request: ComputerRequest,
    signal?: AbortSignal,
  ): Promise<ComputerResult> {
    const image = request.image === true;
    const {
      text,
      structured,
      image: part,
    } = await this.tool(
      "get_window_state",
      {
        pid: target.pid,
        window_id: window,
        include_screenshot: image,
        ...(image ? { max_image_dimension: MAX_IMAGE } : {}),
        ...(request.query ? { query: request.query } : {}),
      },
      signal,
    );
    this.remember(structured, target.pid, window);
    return {
      text: clip(`${target.app.name}, window ${window}\n${text}`),
      ...imageOf(part),
    };
  }

  private async screenshot(
    target: Target,
    window: number,
    signal?: AbortSignal,
  ): Promise<ComputerResult> {
    const { image } = await this.tool(
      "get_window_state",
      {
        pid: target.pid,
        window_id: window,
        include_accessibility_tree: false,
        max_image_dimension: MAX_IMAGE,
      },
      signal,
    );
    if (image?.type !== "image") throw new Error(`No screenshot of ${target.app.name} came back.`);
    return {
      text: `Screenshot of ${target.app.name}, window ${window}. x and y of later steps are pixels in this image.`,
      ...imageOf(image),
    };
  }

  /** The driver tool and arguments of an action that changes something. */
  private action(
    target: Target,
    window: number,
    request: ComputerRequest,
  ): [string, Record<string, unknown>] {
    const { pid } = target;
    const delivery = request.foreground ? { delivery_mode: "foreground", window_id: window } : {};
    const point =
      typeof request.x === "number" && typeof request.y === "number"
        ? { x: request.x, y: request.y, window_id: window }
        : null;
    const element = request.ref ? { element_token: request.ref.trim() } : null;
    const at = (required: boolean) => {
      if (element) return element;
      if (point) return point;
      if (required) throw new Error(`${request.action} needs ref, or x and y.`);
      return {};
    };
    switch (request.action) {
      case "click":
      case "double_click":
      case "right_click":
        return [request.action, { pid, ...at(true), ...delivery }];
      case "type":
        if (!request.text) throw new Error("type needs text.");
        return ["type_text", { pid, text: request.text, ...at(false), ...delivery }];
      case "set_value":
        if (!element || request.value === undefined)
          throw new Error("set_value needs ref and value.");
        return ["set_value", { pid, ...element, value: request.value }];
      case "press":
        if (!request.key) throw new Error("press needs key.");
        return ["press_key", { pid, key: request.key, ...at(false), ...delivery }];
      case "hotkey":
        if (!request.keys?.length) throw new Error("hotkey needs keys.");
        return ["hotkey", { pid, keys: request.keys, ...at(false), ...delivery }];
      case "scroll":
        if (!request.direction) throw new Error("scroll needs direction.");
        return [
          "scroll",
          {
            pid,
            direction: request.direction,
            amount: request.amount ?? 3,
            ...(element ?? { window_id: window }),
            ...(point ?? {}),
            ...delivery,
          },
        ];
      case "drag":
        if (!point || typeof request.toX !== "number" || typeof request.toY !== "number")
          throw new Error("drag needs x, y, toX and toY.");
        return [
          "drag",
          {
            pid,
            window_id: window,
            from_x: point.x,
            from_y: point.y,
            to_x: request.toX,
            to_y: request.toY,
            ...delivery,
          },
        ];
      case "menu":
        if (!request.path?.length) throw new Error("menu needs path.");
        return ["invoke_menu", { pid, window_id: window, path: request.path }];
      default:
        // Read actions are answered before; anything else is not an action of the tool.
        if (COMPUTER_READ_ACTIONS.includes(request.action))
          throw new Error(`${request.action} changes nothing.`);
        throw new Error(`Unknown action ${String(request.action)}.`);
    }
  }
}

function imageOf(part: McpToolResult["content"][number] | undefined): Partial<ComputerResult> {
  if (part?.type !== "image") return {};
  return {
    image: part.data,
    imageType: part.mimeType === "image/jpeg" ? "image/jpeg" : "image/png",
  };
}
