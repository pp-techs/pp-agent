/**
 * Electron accelerators ("CommandOrControl+Shift+Space"), as used for the global shortcut. The
 * main process registers them and the agent process validates what Settings saves, so the grammar
 * lives here.
 */

/** Shortcut that shows the window and focuses the message box, unless the person picked another. */
export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";

/** Lower-cased modifier names → whether they keep the shortcut from firing while typing. */
const MODIFIERS: Record<string, boolean> = {
  command: true,
  cmd: true,
  control: true,
  ctrl: true,
  commandorcontrol: true,
  cmdorctrl: true,
  alt: true,
  option: true,
  altgr: true,
  super: true,
  meta: true,
  // "Shift+A" alone would fire while typing.
  shift: false,
};

/** Lower-cased names of keys that are not a single character. */
const NAMED_KEYS: Record<string, true> = {
  plus: true,
  space: true,
  tab: true,
  capslock: true,
  numlock: true,
  scrolllock: true,
  backspace: true,
  delete: true,
  insert: true,
  return: true,
  enter: true,
  up: true,
  down: true,
  left: true,
  right: true,
  home: true,
  end: true,
  pageup: true,
  pagedown: true,
  escape: true,
  esc: true,
  volumeup: true,
  volumedown: true,
  volumemute: true,
  medianexttrack: true,
  mediaprevioustrack: true,
  mediastop: true,
  mediaplaypause: true,
  printscreen: true,
  numdec: true,
  numadd: true,
  numsub: true,
  nummult: true,
  numdiv: true,
};

const KEY_PATTERN =
  /^(?:[a-z0-9]|f(?:[1-9]|1\d|2[0-4])|num[0-9]|[~!@#$%^&*()_=\-[\]{}\\|;:'",.<>/?`])$/i;

/**
 * Whether `value` is an accelerator that can be a global shortcut: at least one modifier besides
 * Shift, each modifier once, and exactly one key last. `+` separates parts, so the plus key is
 * written `Plus`.
 */
export function isValidAccelerator(value: string): boolean {
  if (value.length === 0 || value.length > 64 || value !== value.trim()) return false;
  const parts = value.split("+");
  const key = parts.pop();
  if (key === undefined) return false;
  if (!KEY_PATTERN.test(key) && !Object.hasOwn(NAMED_KEYS, key.toLowerCase())) return false;
  const seen = new Set<string>();
  let guarded = false;
  for (const part of parts) {
    const name = part.toLowerCase();
    if (!Object.hasOwn(MODIFIERS, name) || seen.has(name)) return false;
    seen.add(name);
    guarded ||= MODIFIERS[name] === true;
  }
  return guarded;
}
