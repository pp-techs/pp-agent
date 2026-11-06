import * as React from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "cn";

/** A single-value slider; `children` render inside the track (tick marks), under the thumb. */
function Slider({
  className,
  children,
  "aria-label": ariaLabel,
  ...props
}: Omit<SliderPrimitive.Root.Props<number>, "children"> & {
  "aria-label"?: string;
  children?: React.ReactNode;
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      thumbAlignment="edge"
      className={cn("w-full data-disabled:opacity-50", className)}
      {...props}
    >
      {/* The pill is the control: its padding keeps the thumb off the ends at the lowest and
          highest step. The track inside is just the thumb's travel. */}
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="flex h-8 w-full touch-none items-center overflow-hidden rounded-full bg-muted px-1 select-none data-disabled:pointer-events-none"
      >
        <SliderPrimitive.Track data-slot="slider-track" className="relative h-full w-full">
          {/* The filled part: from the pill's start, under the thumb, ending in a round cap around
              it (the `before` and `after`); it and the thumb glide between steps. */}
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="bg-foreground/25 transition-[width] duration-200 ease-out before:absolute before:inset-y-0 before:right-full before:w-1 before:bg-foreground/25 after:absolute after:inset-y-0 after:left-full after:w-4 after:rounded-r-[1rem] after:bg-foreground/25 motion-reduce:transition-none"
          />
          {children}
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-label={ariaLabel}
            className="size-6 rounded-full bg-foreground shadow-md transition-[inset-inline-start] duration-200 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
