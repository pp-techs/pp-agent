/**
 * A readable name from an app id, which is all the computer tool's arguments carry: the last part
 * of a bundle id (`com.apple.Notes` → `Notes`), or a program's file name without `.exe`.
 */
export function appLabel(id: string): string {
  const base = (id.split(/[\\/]/).pop() ?? id).replace(/\.(exe|app)$/i, "");
  return /^[\w-]+(\.[\w-]+){2,}$/.test(base) ? (base.split(".").pop() ?? base) : base;
}
