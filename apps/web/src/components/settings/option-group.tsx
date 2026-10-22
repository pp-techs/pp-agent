import type * as React from "react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field";
import { Switch } from "@workspace/ui/components/switch";

/*
 * Settings hierarchy: a group heading at label size with a short description, then its options.
 * A switch that controls the rest of the group is a compact `SwitchRow`; what it controls sits in
 * `SubOptions`, indented behind a subtle rule. Groups are spaced further apart than rows.
 */

/** A titled group of related options. */
export function OptionGroup({
  legend,
  description,
  action,
  children,
}: {
  legend: React.ReactNode;
  description?: React.ReactNode;
  /** Control shown on the heading's right, e.g. "Load from gateway". */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label" className="mb-1 flex w-full items-center gap-2">
        {legend}
        {action && <span className="ml-auto flex items-center gap-2">{action}</span>}
      </FieldLegend>
      {description && <FieldDescription className="-mt-0.5 mb-0">{description}</FieldDescription>}
      {children}
    </FieldSet>
  );
}

/** Compact switch row inside a group: small label, extra-small muted description. */
export function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" className="gap-3">
      <FieldContent className="min-w-0 gap-0.5">
        <FieldLabel htmlFor={id} className="text-sm font-normal">
          {label}
        </FieldLabel>
        {description && <FieldDescription className="text-xs">{description}</FieldDescription>}
      </FieldContent>
      <Switch
        id={id}
        size="sm"
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </Field>
  );
}

/** Options that belong to the row above: indented behind a subtle left rule, smaller text. */
export function SubOptions({ className = "", children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={`ml-1 flex flex-col gap-2.5 border-l border-border/70 pl-4 text-sm ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
