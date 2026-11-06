import * as React from "react";
import { getIconData, iconToSVG, replaceIDs } from "@iconify/utils";
import { cn } from "@workspace/ui/lib/utils";

import { fileIconName, folderIconName } from "@/lib/file-icons";

type IconSet = Parameters<typeof getIconData>[0];

// The whole vscode-icons set is a few MB, so it is its own chunk, fetched when the first file or
// folder is shown. It is bundled, not fetched from Iconify's servers: the app works offline.
let loaded: Promise<IconSet> | undefined;
const loadIcons = () =>
  (loaded ??= import("@iconify-json/vscode-icons/icons.json").then((module) => module.default));

const rendered = new Map<string, { viewBox: string; body: string } | null>();

function render(set: IconSet, name: string) {
  let icon = rendered.get(name);
  if (icon === undefined) {
    const data = getIconData(set, name);
    const svg = data && iconToSVG(data);
    icon = svg ? { viewBox: svg.attributes.viewBox, body: replaceIDs(svg.body) } : null;
    rendered.set(name, icon);
  }
  return icon;
}

function Glyph({ name, className }: { name: string; className?: string }) {
  const icon = render(React.use(loadIcons()), name);
  if (!icon) return null;
  return (
    <svg
      viewBox={icon.viewBox}
      aria-hidden
      className={cn("size-4 shrink-0", className)}
      // The markup is the icon set's own paths, shipped with the app.
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}

/** A file's or folder's icon from the vscode-icons set, picked by its name. */
export function FileTypeIcon({
  name,
  kind,
  open = false,
  className,
}: {
  name: string;
  kind: "file" | "folder";
  /** A folder that is expanded. */
  open?: boolean;
  className?: string;
}) {
  return (
    // The space is held while the set loads, so the rows do not shift.
    <React.Suspense fallback={<span className={cn("size-4 shrink-0", className)} />}>
      <Glyph
        name={kind === "file" ? fileIconName(name) : folderIconName(name, open)}
        className={className}
      />
    </React.Suspense>
  );
}
