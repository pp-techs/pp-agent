import type { ChatMessage } from "@workspace/shared";
import {
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@workspace/ui/components/message-scroller";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "react-i18next";

export interface OutlineTurn {
  key: string;
  /** What the person asked. */
  title: string;
  /** The start of the reply, if any. */
  snippet: string;
}

function firstText(message: ChatMessage | undefined): string {
  for (const part of message?.parts ?? []) {
    if (part.type === "text" && part.text.trim()) return part.text.trim().replace(/\s+/g, " ");
  }
  return "";
}

/** One entry per question the person asked, paired with the start of the answer that follows. */
export function outlineTurns(rows: { key: string; message: ChatMessage }[]): OutlineTurn[] {
  const turns: OutlineTurn[] = [];
  rows.forEach(({ key, message }, index) => {
    if (message.role !== "user") return;
    const reply = rows.slice(index + 1).find((row) => row.message.role !== "compaction");
    turns.push({
      key,
      title: firstText(message) || "…",
      snippet: reply?.message.role === "assistant" ? firstText(reply.message) : "",
    });
  });
  return turns;
}

/** A column of marks at the edge of the chat, one per question: hover to read it, click to jump. */
export function ChatOutline({ turns }: { turns: OutlineTurn[] }) {
  const { scrollToMessage } = useMessageScroller();
  const { currentAnchorId } = useMessageScrollerVisibility();
  const { t } = useTranslation("chat");
  if (turns.length < 2) return null;
  return (
    <nav
      aria-label={t("outline.label")}
      className="pointer-events-none absolute inset-y-0 end-3 z-10 hidden items-center md:flex"
    >
      <ul className="pointer-events-auto flex max-h-[60%] flex-col gap-2 overflow-visible py-2">
        {turns.map((turn) => {
          const active = turn.key === currentAnchorId;
          return (
            <li key={turn.key} className="group/outline relative">
              <button
                type="button"
                aria-label={turn.title}
                aria-current={active || undefined}
                onClick={(event) => {
                  scrollToMessage(turn.key, { align: "start" });
                  event.currentTarget.blur();
                }}
                className="flex h-3 w-8 items-center justify-end"
              >
                <span
                  className={cn(
                    "h-0.5 rounded-full bg-muted-foreground/40 transition-all group-hover/outline:bg-foreground",
                    active ? "w-6 bg-foreground" : "w-4",
                  )}
                />
              </button>
              <div className="pointer-events-none absolute end-full top-1/2 hidden w-64 -translate-y-1/2 pe-2 group-hover/outline:block group-has-focus-visible/outline:block">
                <div className="rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg">
                  <p className="line-clamp-2 text-xs font-medium">{turn.title}</p>
                  {turn.snippet && (
                    <p className="mt-1 line-clamp-3 text-[11px] text-muted-foreground">
                      {turn.snippet}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
