import { createModal } from "@buiducnhat/better-modal";
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

/** `await ConfirmModal.show({...})` resolves to true only when the person confirms. */
export const ConfirmModal = createModal<ConfirmModalProps, boolean>(
  "confirm",
  ({ modal, title, description, confirmLabel }) => (
    <Dialog open={modal.visible} onOpenChange={(open) => !open && modal.resolve(false)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => modal.resolve(false)}>
            Cancel
          </Button>
          <Button onClick={() => modal.resolve(true)}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
);
