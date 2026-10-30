/**
 * Scripts the agent's browser tool runs inside a page. They run in an isolated world: they see
 * the page's DOM but not its JavaScript, so a page cannot read or forge the element references
 * (`globalThis.__ppAgent`), which live for the document until the next snapshot.
 */

/** Isolated world of the agent's scripts (any id other than 0, the page's own world). */
export const AGENT_WORLD = 1001;

/** Most elements one snapshot lists; the rest is reachable by scrolling or `text`. */
export const SNAPSHOT_MAX_ITEMS = 600;

export interface PageSnapshot {
  title: string;
  url: string;
  lines: string[];
  truncated: boolean;
  scrollY: number;
  height: number;
  viewport: number;
}

/**
 * Lists headings, images with text, dialogs and every interactive element in document order,
 * indented inside dialogs, and gives each interactive one a fresh ref (`e1`, `e2`…). Same-origin
 * frames and open shadow roots are included.
 */
export const SNAPSHOT_SCRIPT = `(() => {
  const MAX_ITEMS = ${SNAPSHOT_MAX_ITEMS};
  const state = (globalThis.__ppAgent = { refs: new Map(), next: 1 });
  const lines = [];
  let truncated = false;
  const clean = (text, max = 80) => {
    const value = String(text || "").replace(/\\s+/g, " ").trim();
    return value.length > max ? value.slice(0, max - 1) + "…" : value;
  };
  const quote = (text) => text.replace(/"/g, "'");
  const INPUT_ROLES = { button: "button", submit: "button", reset: "button", image: "button",
    file: "button", color: "button", checkbox: "checkbox", radio: "radio", range: "slider",
    search: "searchbox", number: "spinbutton" };
  const INTERACTIVE = new Set(["link", "button", "checkbox", "radio", "switch", "slider", "textbox",
    "searchbox", "combobox", "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio",
    "tab", "treeitem", "spinbutton"]);
  const LEAF = new Set(["link", "button", "checkbox", "radio", "switch", "slider", "textbox",
    "searchbox", "combobox", "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio",
    "tab", "spinbutton", "heading", "img"]);
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "SVG"]);
  const roleOf = (el) => {
    const explicit = (el.getAttribute("role") || "").trim().split(/\\s+/)[0];
    if (explicit && explicit !== "presentation" && explicit !== "none") return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return el.multiple ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return type === "hidden" ? null : INPUT_ROLES[type] || "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return el.getAttribute("alt") ? "img" : null;
    if (tag === "dialog") return "dialog";
    if (el.isContentEditable && el.hasAttribute("contenteditable")) return "textbox";
    return null;
  };
  const nameOf = (el, role) => {
    const doc = el.ownerDocument;
    const label = el.getAttribute("aria-label");
    if (label) return clean(label);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const text = by.split(/\\s+/).map((id) => (doc.getElementById(id) || {}).innerText || "").join(" ");
      if (text.trim()) return clean(text);
    }
    if (el.labels && el.labels.length) return clean([...el.labels].map((item) => item.innerText).join(" "));
    if (role === "img") return clean(el.getAttribute("alt"));
    if (el.tagName === "INPUT" && ["button", "submit", "reset"].includes(el.type)) return clean(el.value);
    const fields = ["textbox", "searchbox", "combobox", "listbox", "spinbutton"];
    const text = fields.includes(role) ? "" : el.innerText;
    return clean(text || el.getAttribute("placeholder") || el.getAttribute("title") || "");
  };
  const hidden = (el) => {
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return true;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse";
  };
  const sized = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const describe = (el, role, depth) => {
    let line = "  ".repeat(depth) + "- " + role;
    const name = nameOf(el, role);
    if (name) line += ' "' + quote(name) + '"';
    if (role === "heading") line += " [level=" + (el.getAttribute("aria-level") || el.tagName.slice(1)) + "]";
    if (INTERACTIVE.has(role)) {
      const ref = "e" + state.next++;
      state.refs.set(ref, el);
      line += " [ref=" + ref + "]";
    }
    if (el.tagName === "SELECT") {
      const chosen = [...el.selectedOptions].map((option) => clean(option.label, 40));
      if (chosen.length) line += ' value="' + quote(chosen.join(", ")) + '"';
      const options = [...el.options].slice(0, 15).map((option) => clean(option.label, 30));
      line += " options=[" + options.join(" | ") + (el.options.length > 15 ? " | …" : "") + "]";
    } else if (["textbox", "searchbox", "spinbutton", "combobox"].includes(role)) {
      const raw = "value" in el ? el.value : el.isContentEditable ? el.innerText : "";
      const value = el.type === "password" ? (raw ? "••••" : "") : clean(raw, 60);
      if (value) line += ' value="' + quote(value) + '"';
    }
    if (el.checked === true || el.getAttribute("aria-checked") === "true") line += " [checked]";
    if (el.disabled === true || el.getAttribute("aria-disabled") === "true") line += " [disabled]";
    const expanded = el.getAttribute("aria-expanded");
    if (expanded) line += " [expanded=" + expanded + "]";
    if (el.getAttribute("aria-selected") === "true") line += " [selected]";
    if (role === "link") {
      const href = el.getAttribute("href") || "";
      if (href && !href.startsWith("javascript:")) line += " -> " + clean(href, 100);
    }
    return line;
  };
  const walk = (root, depth) => {
    for (const el of root.children) {
      if (lines.length >= MAX_ITEMS) {
        truncated = true;
        return;
      }
      if (SKIP.has(el.tagName.toUpperCase()) || hidden(el)) continue;
      const role = roleOf(el);
      let inner = depth;
      if (role && (INTERACTIVE.has(role) || ["heading", "img", "dialog", "alertdialog"].includes(role)) && sized(el)) {
        lines.push(describe(el, role, depth));
        if (role === "dialog" || role === "alertdialog") inner = depth + 1;
        if (LEAF.has(role)) continue;
      }
      if (el.tagName === "IFRAME") {
        try {
          const doc = el.contentDocument;
          if (doc && doc.body) {
            lines.push("  ".repeat(depth) + "- frame");
            walk(doc.body, depth + 1);
          }
        } catch {
          // A cross-origin frame: not readable from here.
        }
        continue;
      }
      if (el.shadowRoot) walk(el.shadowRoot, inner);
      walk(el, inner);
    }
  };
  if (document.body) walk(document.body, 0);
  return {
    title: document.title,
    url: location.href,
    lines,
    truncated,
    scrollY: Math.round(scrollY),
    height: Math.round(document.documentElement.scrollHeight),
    viewport: innerHeight,
  };
})()`;

/** What `elementScript` does with the element of a ref. */
export type ElementOperation =
  | { op: "point" }
  | { op: "focus"; selectAll: boolean }
  | { op: "select"; values: string[] }
  | { op: "scroll"; by: number }
  | { op: "click" };

export type ElementOutcome =
  | { error: "stale" }
  | { error: "not-select" }
  | { error: "no-option"; options: string[] }
  | { x: number; y: number; width: number; height: number; name: string }
  | { ok: true; name: string; chosen?: string[] };

/**
 * Finds the element of `ref` and acts on it. `point` scrolls it into view and returns its centre
 * in the top page's coordinates (adding the offsets of the frames it sits in), for a real click.
 */
export function elementScript(ref: string, operation: ElementOperation): string {
  return `((ref, operation) => {
  const state = globalThis.__ppAgent;
  const el = state && state.refs.get(ref);
  if (!el || !el.isConnected) return { error: "stale" };
  const name = String(el.getAttribute("aria-label") || el.innerText || el.value || el.tagName.toLowerCase())
    .replace(/\\s+/g, " ").trim().slice(0, 60);
  const doc = el.ownerDocument;
  if (operation.op === "scroll") {
    el.scrollBy({ top: operation.by, behavior: "instant" });
    return { ok: true, name };
  }
  if (operation.op === "click") {
    el.click();
    return { ok: true, name };
  }
  if (operation.op === "select") {
    if (el.tagName !== "SELECT") return { error: "not-select" };
    const wanted = operation.values.map((value) => value.trim().toLowerCase());
    const options = [...el.options];
    const matches = options.filter(
      (option) => wanted.includes(option.value.toLowerCase()) || wanted.includes(option.label.trim().toLowerCase()),
    );
    if (matches.length === 0) return { error: "no-option", options: options.map((option) => option.label).slice(0, 30) };
    for (const option of options) option.selected = matches.includes(option) && (el.multiple || option === matches[0]);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, name, chosen: matches.map((option) => option.label) };
  }
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  if (operation.op === "focus") {
    el.focus();
    if (operation.selectAll) {
      if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && typeof el.select === "function") el.select();
      else if (el.isContentEditable) {
        const range = doc.createRange();
        range.selectNodeContents(el);
        const selection = doc.defaultView.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    return { ok: true, name };
  }
  const rect = el.getBoundingClientRect();
  let x = rect.left + rect.width / 2;
  let y = rect.top + rect.height / 2;
  let view = doc.defaultView;
  while (view && view.frameElement) {
    const frame = view.frameElement.getBoundingClientRect();
    x += frame.left;
    y += frame.top;
    view = view.parent;
  }
  return { x, y, width: rect.width, height: rect.height, name };
})(${JSON.stringify(ref)}, ${JSON.stringify(operation)})`;
}

/** The page's readable text, with runs of blank lines collapsed. */
export const TEXT_SCRIPT = `(() => {
  const text = document.body ? document.body.innerText : "";
  return { title: document.title, url: location.href, text: text.replace(/\\n{3,}/g, "\\n\\n").trim() };
})()`;

/** Whether the page's text contains `needle`, for `wait`. */
export function containsTextScript(needle: string): string {
  return `(document.body ? document.body.innerText : "").includes(${JSON.stringify(needle)})`;
}

/** Scrolls the page by a share of the viewport (positive is down). */
export function scrollPageScript(share: number): string {
  return `(() => { window.scrollBy({ top: innerHeight * ${share}, behavior: "instant" }); return true; })()`;
}
