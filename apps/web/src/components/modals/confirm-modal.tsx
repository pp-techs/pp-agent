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

type ConfirmModalProps = {
  title: string;
  description: string;
  confirmLabel: string;
};

function ConfirmDialog({
  visible,
  title,
  description,
  confirmLabel,
  onResolve,
}: ConfirmModalProps & { visible: boolean; onResolve: (confirmed: boolean) => void }) {
  const { t } = useTranslation("common");
  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onResolve(false)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onResolve(false)}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => onResolve(true)}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** `await ConfirmModal.show({...})` resolves to true only when the person confirms. */
export const ConfirmModal = createModal<ConfirmModalProps, boolean>(
  "confirm",
  ({ modal, ...props }) => (
    <ConfirmDialog {...props} visible={modal.visible} onResolve={(value) => modal.resolve(value)} />
  ),
);
