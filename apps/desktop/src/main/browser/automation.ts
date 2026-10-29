import type { BrowserProfile, BrowserRequest, BrowserResult, BrowserTab } from "@workspace/shared";
import type { WebContents } from "electron";
import type { BrowserHost } from "./host.ts";
import {
  AGENT_WORLD,
  containsTextScript,
  type ElementOperation,
  type ElementOutcome,
  elementScript,
  type PageSnapshot,
  scrollPageScript,
  SNAPSHOT_SCRIPT,
  TEXT_SCRIPT,
} from "./page-script.ts";

const TEXT_CHARS = 20_000;
const SNAPSHOT_CHARS = 25_000;
const EVAL_CHARS = 10_000;
const LOAD_TIMEOUT_MS = 20_000;
const WAIT_DEFAULT_MS = 1_000;
const WAIT_MAX_MS = 30_000;
const SCREENSHOT_MAX_WIDTH = 1280;
/** Pixels a scrollable element moves per `scroll` step, before the 0.8 share. */
const ELEMENT_SCROLL = 600;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface BrowserAutomationOptions {
  host: BrowserHost;
  profiles(): Promise<BrowserProfile[]>;
  /** Shows the side panel's browser, so the person sees what the agent does. */
  reveal(): void;
}

type KeyModifier = "control" | "shift" | "alt" | "meta";

/** Electron key code and modifiers for a key such as `Enter`, `ArrowDown` or `Control+A`. */
export function parseKey(input: string): {
  keyCode: string;
  modifiers: KeyModifier[];
  char?: string;
} {
  const parts = input.split("+").map((part) => part.trim());
  // "Control++" means the plus key.
  if (input.endsWith("++")) parts.splice(parts.length - 2, 2, "+");
  const key = parts.pop() || "";
  const MODIFIERS: Record<string, KeyModifier> = {
    control: "control",
    ctrl: "control",
    shift: "shift",
    alt: "alt",
    option: "alt",
    meta: "meta",
    cmd: "meta",
    command: "meta",
  };
  const modifiers = parts
    .map((part) => MODIFIERS[part.toLowerCase()])
    .filter((modifier): modifier is KeyModifier => modifier !== undefined);
  const NAMES: Record<string, string> = {
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    enter: "Enter",
    return: "Enter",
    escape: "Escape",
    esc: "Escape",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    space: "Space",
    " ": "Space",
  };
  const named = NAMES[key.toLowerCase()];
  if (named) {
    const char =
      modifiers.length > 0
        ? undefined
        : named === "Enter"
          ? "\r"
          : named === "Space"
            ? " "
            : undefined;
    return char === undefined ? { keyCode: named, modifiers } : { keyCode: named, modifiers, char };
  }
  if (key.length === 1)
    return modifiers.length > 0
      ? { keyCode: key, modifiers }
      : { keyCode: key, modifiers, char: key };
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) return { keyCode: key.toUpperCase(), modifiers };
  throw new Error(
    `Unknown key "${input}". Use names such as Enter, Tab, Escape, ArrowDown, or Control+A.`,
  );
}

/** The lines the model reads for a snapshot. */
export function formatSnapshot(
  tab: BrowserTab,
  profileName: string,
  snapshot: PageSnapshot,
): string {
  const header = [
    `Tab ${tab.id} (profile ${profileName})`,
    `Title: ${snapshot.title || "(untitled)"}`,
    `URL: ${snapshot.url}`,
    `Scrolled to ${snapshot.scrollY} of ${snapshot.height} px (window ${snapshot.viewport} px)`,
  ];
  let body =
    snapshot.lines.length > 0
      ? snapshot.lines.join("\n")
      : "(No headings or interactive elements.)";
  let note = snapshot.truncated
    ? "\n[The snapshot stops here; scroll or use text for the rest of the page.]"
    : "";
  if (body.length > SNAPSHOT_CHARS) {
    body = body.slice(0, SNAPSHOT_CHARS);
    note = "\n[The snapshot was cut short; scroll or use text for the rest of the page.]";
  }
  return `${header.join("\n")}\n\n${body}${note}`;
}

/**
 * Runs the agent's `browser` tool calls on the side panel browser. Pages it acts on become the
 * active tab and the panel shows the browser, so the person watches every step. Messages are for
 * the model (English).
 */
export class BrowserAutomation {
  constructor(private readonly options: BrowserAutomationOptions) {}

  async run(request: BrowserRequest): Promise<BrowserResult> {
    const { host } = this.options;
    switch (request.action) {
      case "tabs":
        return { text: await this.describeTabs() };
      case "open": {
        const profile = await this.resolveProfile(request.profile);
        const tab = await host.open(profile.id, request.url);
        this.options.reveal();
        return this.afterChange(tab.id, `Opened tab ${tab.id} in profile ${profile.name}.`);
      }
      case "select": {
        const tab = this.requireTab(request.tab);
        await this.show(tab.id);
        return this.afterChange(tab.id, `Switched to tab ${tab.id}.`, false);
      }
      case "close": {
        const tab = this.requireTab(request.tab);
        await host.close(tab.id);
        return { text: `Closed tab ${tab.id}.\n\n${await this.describeTabs()}` };
      }
      case "navigate": {
        if (!request.url) throw new Error("navigate needs url.");
        const tab = await this.useTab(request.tab);
        await host.navigate(tab.id, request.url);
        return this.afterChange(tab.id, `Went to ${request.url}.`);
      }
      case "back":
      case "forward":
      case "reload": {
        const tab = await this.useTab(request.tab);
        await host.go(tab.id, request.action);
        return this.afterChange(tab.id, `Did ${request.action}.`);
      }
      case "snapshot": {
        const tab = await this.useTab(request.tab);
        return { text: await this.snapshot(tab) };
      }
      case "text":
        return this.text(await this.useTab(request.tab), request.offset ?? 0);
      case "screenshot":
        return this.screenshot(await this.useTab(request.tab));
      case "click":
        return this.click(await this.useTab(request.tab), this.requireRef(request));
      case "type":
        return this.type(await this.useTab(request.tab), request);
      case "press": {
        if (!request.key) throw new Error("press needs key.");
        const tab = await this.useTab(request.tab);
        const contents = host.contentsOf(tab.id);
        contents.focus();
        this.pressKey(contents, request.key);
        return this.afterChange(tab.id, `Pressed ${request.key}.`);
      }
      case "select_option": {
        const tab = await this.useTab(request.tab);
        if (!request.values?.length) throw new Error("select_option needs values.");
        const outcome = await this.element(tab, this.requireRef(request), {
          op: "select",
          values: request.values,
        });
        if ("error" in outcome) {
          if (outcome.error === "not-select")
            throw new Error(
              "That element is not a list of options; click it and pick an option instead.",
            );
          if (outcome.error === "no-option")
            throw new Error(`No option matches. Options: ${outcome.options.join(" | ")}`);
        }
        const chosen = "chosen" in outcome ? (outcome.chosen ?? []).join(", ") : "";
        return this.afterChange(tab.id, `Selected ${chosen}.`);
      }
      case "scroll": {
        const tab = await this.useTab(request.tab);
        const share = request.direction === "up" ? -0.8 : 0.8;
        if (request.ref) {
          await this.element(tab, request.ref, {
            op: "scroll",
            by: Math.round(ELEMENT_SCROLL * share),
          });
        } else {
          await this.isolated(host.contentsOf(tab.id), scrollPageScript(share));
        }
        return this.afterChange(tab.id, `Scrolled ${request.direction ?? "down"}.`, false);
      }
      case "wait":
        return this.wait(await this.useTab(request.tab), request);
      case "eval": {
        if (!request.expression) throw new Error("eval needs expression.");
        const tab = await this.useTab(request.tab);
        const value: unknown = await host.evaluate(tab.id, request.expression);
        let text =
          value === undefined
            ? "undefined"
            : (JSON.stringify(value, null, 2) ?? `(${typeof value})`);
        if (text.length > EVAL_CHARS) text = `${text.slice(0, EVAL_CHARS)}\n[Result cut short.]`;
        return { text };
      }
      default: {
        const unknown: never = request.action;
        throw new Error(`Unknown browser action ${String(unknown)}.`);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Tabs and profiles
  // -------------------------------------------------------------------------------------------

  private async describeTabs(): Promise<string> {
    const state = this.options.host.state();
    const profiles = await this.options.profiles();
    const nameOf = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? id;
    const tabs =
      state.tabs.length === 0
        ? "No tabs are open."
        : state.tabs
            .map(
              (tab) =>
                `- ${tab.id}${tab.id === state.activeId ? " (active)" : ""}: ${tab.title || "(untitled)"} ${tab.url || "about:blank"} [profile ${nameOf(tab.profileId)}]`,
            )
            .join("\n");
    const profileList = profiles.map((profile) => profile.name).join(", ");
    return `Tabs:\n${tabs}\n\nProfiles: ${profileList} (the first is the default)`;
  }

  /** A profile by name or id (case-insensitive); the default profile when none is named. */
  private async resolveProfile(wanted: string | undefined): Promise<BrowserProfile> {
    const profiles = await this.options.profiles();
    if (!wanted) return profiles[0];
    const key = wanted.trim().toLowerCase();
    const profile = profiles.find(
      (entry) => entry.id.toLowerCase() === key || entry.name.toLowerCase() === key,
    );
    if (!profile)
      throw new Error(
        `No browser profile named "${wanted}". Profiles: ${profiles.map((entry) => entry.name).join(", ")}.`,
      );
    return profile;
  }

  private requireTab(id: string | undefined): BrowserTab {
    const state = this.options.host.state();
    const wanted = id ?? state.activeId;
    const tab = state.tabs.find((entry) => entry.id === wanted);
    if (!tab)
      throw new Error(
        id
          ? `There is no tab ${id}. Use tabs to list the open tabs.`
          : "No tab is open. Use open with a url first.",
      );
    return tab;
  }

  /** The tab to act on, made the active one and shown in the panel. */
  private async useTab(id: string | undefined): Promise<BrowserTab> {
    const tab = this.requireTab(id);
    await this.show(tab.id);
    return tab;
  }

  private async show(tabId: string): Promise<void> {
    const { host } = this.options;
    if (host.state().activeId !== tabId) await host.activate(tabId);
    this.options.reveal();
  }

  private requireRef(request: BrowserRequest): string {
    if (!request.ref) throw new Error(`${request.action} needs ref (from snapshot).`);
    return request.ref;
  }

  // -------------------------------------------------------------------------------------------
  // Pages
  // -------------------------------------------------------------------------------------------

  private isolated<T>(contents: WebContents, code: string): Promise<T> {
    return contents.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code }], true) as Promise<T>;
  }

  private async element(
    tab: BrowserTab,
    ref: string,
    operation: ElementOperation,
  ): Promise<ElementOutcome> {
    const outcome = await this.isolated<ElementOutcome>(
      this.options.host.contentsOf(tab.id),
      elementScript(ref, operation),
    );
    if ("error" in outcome && outcome.error === "stale")
      throw new Error(`Element ${ref} is not on the page any more. Take a new snapshot.`);
    return outcome;
  }

  /** Waits for a navigation the last step may have started, then for the page to settle. */
  private async settle(contents: WebContents): Promise<void> {
    await delay(250);
    if (contents.isLoading()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, LOAD_TIMEOUT_MS);
        contents.once("did-stop-loading", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    await delay(150);
  }

  private async snapshot(tab: BrowserTab): Promise<string> {
    const contents = this.options.host.contentsOf(tab.id);
    const snapshot = await this.isolated<PageSnapshot>(contents, SNAPSHOT_SCRIPT);
    const profiles = await this.options.profiles();
    const name = profiles.find((profile) => profile.id === tab.profileId)?.name ?? tab.profileId;
    return formatSnapshot(tab, name, snapshot);
  }

  /** After a step that may change the page: what was done, and the page as it is now. */
  private async afterChange(tabId: string, done: string, settle = true): Promise<BrowserResult> {
    if (settle) await this.settle(this.options.host.contentsOf(tabId));
    const tab = this.requireTab(tabId);
    return { text: `${done}\n\n${await this.snapshot(tab)}` };
  }

  private async click(tab: BrowserTab, ref: string): Promise<BrowserResult> {
    const contents = this.options.host.contentsOf(tab.id);
    const outcome = await this.element(tab, ref, { op: "point" });
    if (!("x" in outcome)) throw new Error(`Element ${ref} cannot be clicked.`);
    if (outcome.width === 0 || outcome.height === 0) {
      // Not laid out (an invisible input behind a styled label): click it from script.
      await this.element(tab, ref, { op: "click" });
    } else {
      const x = Math.round(outcome.x);
      const y = Math.round(outcome.y);
      contents.sendInputEvent({ type: "mouseMove", x, y });
      contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
      contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
    }
    return this.afterChange(tab.id, `Clicked ${ref}${outcome.name ? ` (${outcome.name})` : ""}.`);
  }

  private async type(tab: BrowserTab, request: BrowserRequest): Promise<BrowserResult> {
    const ref = this.requireRef(request);
    if (request.text === undefined) throw new Error("type needs text.");
    const contents = this.options.host.contentsOf(tab.id);
    // The page must have the keyboard for the text to reach the field.
    contents.focus();
    await this.element(tab, ref, { op: "focus", selectAll: request.clear !== false });
    if (request.clear !== false && request.text === "") this.pressKey(contents, "Backspace");
    else await contents.insertText(request.text);
    if (request.submit) this.pressKey(contents, "Enter");
    return this.afterChange(
      tab.id,
      `Typed into ${ref}${request.submit ? " and pressed Enter" : ""}.`,
    );
  }

  private pressKey(contents: WebContents, key: string): void {
    const { keyCode, modifiers, char } = parseKey(key);
    contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    if (char !== undefined) contents.sendInputEvent({ type: "char", keyCode: char, modifiers });
    contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  }

  private async text(tab: BrowserTab, offset: number): Promise<BrowserResult> {
    const page = await this.isolated<{ title: string; url: string; text: string }>(
      this.options.host.contentsOf(tab.id),
      TEXT_SCRIPT,
    );
    const slice = page.text.slice(offset, offset + TEXT_CHARS);
    const end = offset + slice.length;
    const note =
      end < page.text.length
        ? `\n\n[Showing characters ${offset}–${end} of ${page.text.length}. Continue with offset=${end}.]`
        : "";
    return {
      text: `Tab ${tab.id}\nTitle: ${page.title || "(untitled)"}\nURL: ${page.url}\n\n${slice || "(No text.)"}${note}`,
    };
  }

  private async screenshot(tab: BrowserTab): Promise<BrowserResult> {
    let image = await this.options.host.contentsOf(tab.id).capturePage();
    if (image.isEmpty())
      throw new Error("The page could not be captured; the PP Agent window may be minimized.");
    if (image.getSize().width > SCREENSHOT_MAX_WIDTH)
      image = image.resize({ width: SCREENSHOT_MAX_WIDTH });
    return {
      text: `Screenshot of tab ${tab.id}: ${tab.title || "(untitled)"} ${tab.url}`,
      image: image.toPNG().toString("base64"),
    };
  }

  private async wait(tab: BrowserTab, request: BrowserRequest): Promise<BrowserResult> {
    const contents = this.options.host.contentsOf(tab.id);
    const limit = Math.min(request.ms ?? (request.text ? 10_000 : WAIT_DEFAULT_MS), WAIT_MAX_MS);
    if (!request.text) {
      await delay(limit);
      return this.afterChange(tab.id, `Waited ${limit} ms.`, false);
    }
    const deadline = Date.now() + limit;
    while (Date.now() < deadline) {
      if (await this.isolated<boolean>(contents, containsTextScript(request.text)))
        return this.afterChange(tab.id, `"${request.text}" is on the page.`, false);
      await delay(250);
    }
    throw new Error(`"${request.text}" did not appear within ${limit} ms.`);
  }
}
