/**
 * Copies text to the clipboard. The Clipboard API exists only in secure contexts, and the web app
 * on the local network is served over plain HTTP, so it falls back to a hidden text field there.
 */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  field.style.pointerEvents = "none";
  document.body.append(field);
  field.select();
  field.setSelectionRange(0, text.length);
  try {
    // Deprecated, but the only way to copy without a secure context.
    if (!document.execCommand("copy")) throw new Error("Copy failed.");
  } finally {
    field.remove();
  }
}
