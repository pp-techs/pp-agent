import * as React from "react";
import type { Attachment as NewAttachment, ChatPart, DesktopBridge } from "@workspace/shared";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@workspace/ui/components/attachment";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { FileTextIcon, PaperclipIcon, SparklesIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export interface MessageEdit {
  text: string;
  /** Attachments added while editing. */
  attachments: NewAttachment[];
  /** What of the original message is sent again: workspace file paths and image indexes. */
  keep: { files: string[]; images: number[] };
}

/** Edits a sent message in place: its text, which attachments stay, and new attachments. */
export function MessageEditor({
  bridge,
  parts,
  pending,
  onSubmit,
  onCancel,
}: {
  bridge: DesktopBridge;
  parts: ChatPart[];
  pending: boolean;
  onSubmit: (edit: MessageEdit) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("chat");
  const initialText = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const skills = parts.filter((part) => part.type === "skill");
  const images = parts.filter((part) => part.type === "image");
  const files = parts.filter((part) => part.type === "file");
  const [text, setText] = React.useState(initialText);
  const [removedFiles, setRemovedFiles] = React.useState<ReadonlySet<string>>(new Set());
  const [removedImages, setRemovedImages] = React.useState<ReadonlySet<number>>(new Set());
  const [added, setAdded] = React.useState<NewAttachment[]>([]);

  const keptFiles = files.filter((file) => !removedFiles.has(file.path));
  const keptImages = images.map((_, index) => index).filter((index) => !removedImages.has(index));
  // A skill command or an attachment is a message on its own; text is not required then.
  const canSend =
    !pending &&
    (text.trim().length > 0 ||
      skills.length + keptFiles.length + keptImages.length + added.length > 0);

  function submit() {
    if (!canSend) return;
    onSubmit({
      text,
      attachments: added,
      keep: { files: keptFiles.map((file) => file.path), images: keptImages },
    });
  }

  async function pick() {
    try {
      const picked = await bridge.files.pick();
      setAdded((previous) => [...previous, ...picked]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  const remove = (label: string, onClick: () => void) => (
    <AttachmentActions>
      <AttachmentAction
        aria-label={t("message.actions.removeAttachment", { name: label })}
        onClick={onClick}
      >
        <XIcon />
      </AttachmentAction>
    </AttachmentActions>
  );

  return (
    <form
      className="flex w-full flex-col gap-2 rounded-2xl border bg-muted/40 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((skill, index) => (
            <Badge key={index} variant="secondary">
              <SparklesIcon data-icon="inline-start" />
              {t("message.skill", { name: skill.name })}
            </Badge>
          ))}
        </div>
      )}
      <Textarea
        autoFocus
        aria-label={t("message.actions.editLabel")}
        value={text}
        className="min-h-16 bg-background"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {(keptImages.length > 0 || keptFiles.length > 0 || added.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {keptImages.map((index) => {
            const image = images[index];
            return image ? (
              <Attachment key={`image-${index}`} size="sm">
                <AttachmentMedia variant="image">
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={t("message.attachedImage")}
                  />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{t("message.attachedImage")}</AttachmentTitle>
                </AttachmentContent>
                {remove(t("message.attachedImage"), () =>
                  setRemovedImages((previous) => new Set(previous).add(index)),
                )}
              </Attachment>
            ) : null;
          })}
          {keptFiles.map((file) => (
            <Attachment key={file.path} size="sm" title={file.path}>
              <AttachmentMedia>
                <FileTextIcon />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{file.name}</AttachmentTitle>
              </AttachmentContent>
              {remove(file.name, () =>
                setRemovedFiles((previous) => new Set(previous).add(file.path)),
              )}
            </Attachment>
          ))}
          {added.map((attachment, index) => (
            <Attachment key={`new-${index}`} size="sm">
              <AttachmentMedia variant={attachment.data ? "image" : "icon"}>
                {attachment.data ? (
                  <img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt="" />
                ) : (
                  <FileTextIcon />
                )}
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{attachment.name}</AttachmentTitle>
              </AttachmentContent>
              {remove(attachment.name, () =>
                setAdded((previous) => previous.filter((_, position) => position !== index)),
              )}
            </Attachment>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => void pick()}>
          <PaperclipIcon data-icon="inline-start" />
          {t("message.actions.addFile")}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {t("message.actions.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={!canSend}>
            {t("message.actions.resend")}
          </Button>
        </div>
      </div>
    </form>
  );
}
