import * as React from "react";

/**
 * An image whose bytes travel inline as base64 (a pasted image, an image of a sent message). The
 * `data:` URL is built once per image, not on every render of the message list or the composer,
 * where it would copy megabytes each time.
 */
export const InlineImage = React.memo(function InlineImage({
  data,
  mimeType,
  alt,
  ...props
}: Omit<React.ComponentProps<"img">, "src" | "alt"> & {
  data: string;
  mimeType: string;
  alt: string;
}) {
  const src = React.useMemo(() => `data:${mimeType};base64,${data}`, [data, mimeType]);
  return <img src={src} alt={alt} {...props} />;
});
