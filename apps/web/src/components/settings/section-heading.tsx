import type * as React from "react";

/** Title row of a Settings section, with optional actions on the right. */
export function SectionHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 font-heading text-base font-medium">{title}</h2>
        {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </header>
  );
}
