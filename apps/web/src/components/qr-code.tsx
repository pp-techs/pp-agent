import * as React from "react";
import { cn } from "@workspace/ui/lib/utils";
import { encode } from "uqr";

/**
 * A QR code drawn as one SVG path. Always dark on white, whatever the theme: phone cameras read
 * inverted codes poorly.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { size, path } = React.useMemo(() => {
    const { data } = encode(value, { ecc: "M", border: 2 });
    let d = "";
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: data.length, path: d };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn("rounded-lg bg-white text-black", className)}
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
