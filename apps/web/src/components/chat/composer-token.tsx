import { SparklesIcon, TerminalIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * The skill or command a message starts with, in place of its raw `/skill:abc ` text in the
 * message box. It reads as part of the first line; the cross (or Backspace before the text) drops it.
 */
export function ComposerToken({
  kind,
  name,
  disabled,
  onRemove,
}: {
  kind: "skill" | "command";
  name: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation("chat");
  const Icon = kind === "skill" ? SparklesIcon : TerminalIcon;
  const label = kind === "skill" ? name : `/${name}`;
  return (
    <span
      data-slot="composer-token"
      className="mt-1 ml-1 inline-flex h-7 max-w-[60%] shrink-0 items-center gap-1.5 rounded-full bg-foreground/10 pr-1 pl-2.5 text-sm font-medium text-foreground"
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-label={t("composer.removeToken", { name: label })}
        className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none"
        // Keep the focus (and caret) in the text.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}
