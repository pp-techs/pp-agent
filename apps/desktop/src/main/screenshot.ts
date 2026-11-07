import type { NativeImage } from "electron";

/** Long edge of the screenshots the agent's tools return, in pixels. */
export const SCREENSHOT_MAX_EDGE = 1280;
/** JPEG keeps a window or page screenshot readable for the model at a fraction of PNG's size. */
const JPEG_QUALITY = 80;

/**
 * A screenshot as the model gets it: at most `SCREENSHOT_MAX_EDGE` pixels on its long edge, as a
 * base64 JPEG.
 */
export function modelImage(image: NativeImage): { image: string; imageType: "image/jpeg" } {
  const { width, height } = image.getSize();
  const scale = SCREENSHOT_MAX_EDGE / Math.max(width, height);
  const sized =
    scale < 1
      ? image.resize({
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          quality: "good",
        })
      : image;
  return { image: sized.toJPEG(JPEG_QUALITY).toString("base64"), imageType: "image/jpeg" };
}
