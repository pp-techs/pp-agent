/**
 * iOS (Safari and the phone app's WKWebView) zooms the page in when a field whose text is under
 * 16px gets focus, and leaves it zoomed. `maximum-scale=1` stops that; iOS still lets the person
 * pinch to zoom, so it costs nothing there. Not set elsewhere: Android would honour it and block
 * pinch zoom.
 */
function isIos(): boolean {
  const agent = navigator.userAgent;
  // iPadOS reports itself as a Mac; a Mac has no touch screen.
  return (
    /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)
  );
}

export function preventIosFocusZoom(): void {
  if (!isIos()) return;
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport || /maximum-scale/.test(viewport.content)) return;
  viewport.content = `${viewport.content}, maximum-scale=1`;
}
