import * as React from "react";
import { createModal } from "@buiducnhat/better-modal";
import { useTranslation } from "react-i18next";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";

type PromptModalProps = {
  title: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  /** Explains what to type, under the title. */
  description?: string;
  placeholder?: string;
  /** Hide what is typed (a token). */
  secret?: boolean;
};

function PromptForm({
  title,
  label,
  initialValue,
  confirmLabel,
  description,
  placeholder,
  secret,
  onDone,
}: PromptModalProps & { onDone: (value: string | null) => void }) {
  const { t } = useTranslation("common");
  const [value, setValue] = React.useState(initialValue);
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onDone(value.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <Input
        aria-label={label}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        type={secret ? "password" : "text"}
        autoComplete="off"
        autoFocus
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onDone(null)}>
          {t("actions.cancel")}
        </Button>
        <Button type="submit" disabled={!value.trim()}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** `await PromptModal.show({...})` resolves to the entered text, or null when cancelled. */
export const PromptModal = createModal<PromptModalProps, string | null>(
  "prompt",
  ({ modal, ...props }) => (
    <Dialog open={modal.visible} onOpenChange={(open) => !open && modal.resolve(null)}>
      <DialogContent showCloseButton={false}>
        {/* The modal stays mounted between uses; remount the form so each open starts fresh. */}
        <PromptForm
          key={`${modal.visible}-${props.initialValue}`}
          {...props}
          onDone={(value) => modal.resolve(value)}
        />
      </DialogContent>
    </Dialog>
  ),
);
