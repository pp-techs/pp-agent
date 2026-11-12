import type * as React from "react";

/** A logo on a white tile, so dark marks (Notion) stay readable in the dark theme too. */
export function BrandLogo({ src, fallback }: { src: string | null; fallback: React.ReactNode }) {
  return src ? (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-white p-2">
      <img src={src} alt="" draggable={false} className="size-full object-contain" />
    </span>
  ) : (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-muted text-muted-foreground [&>svg]:size-5">
      {fallback}
    </span>
  );
}
