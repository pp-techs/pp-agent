import * as React from "react";
import { createModal } from "@buiducnhat/better-modal";
import type { AuthPrompt, DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

function PromptForm({
  prompt,
  onSubmit,
  onCancel,
}: {
  prompt: AuthPrompt;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["modals", "common"]);
  const options = prompt.options ?? [];
  const [value, setValue] = React.useState(prompt.kind === "select" ? (options[0]?.id ?? "") : "");
  const canSubmit = prompt.kind === "select" ? value !== "" : value.trim() !== "";

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(prompt.kind === "select" ? value : value.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>{prompt.flowTitle}</DialogTitle>
        <DialogDescription className="whitespace-pre-wrap">{prompt.message}</DialogDescription>
      </DialogHeader>
      {prompt.kind === "select" ? (
        <RadioGroup
          aria-label={prompt.message}
          value={value}
          onValueChange={(next) => {
            if (typeof next === "string") setValue(next);
          }}
        >
          {options.map((option) => (
            <Field key={option.id} orientation="horizontal">
              <RadioGroupItem value={option.id} id={`auth-option-${option.id}`} />
              <FieldContent>
                <FieldLabel htmlFor={`auth-option-${option.id}`}>{option.label}</FieldLabel>
                {option.description && <FieldDescription>{option.description}</FieldDescription>}
              </FieldContent>
            </Field>
          ))}
        </RadioGroup>
      ) : (
        <Input
          aria-label={prompt.message}
          type={prompt.kind === "secret" ? "password" : "text"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={prompt.placeholder}
          autoComplete="off"
          autoFocus
        />
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {t("modals:authPrompt.continue")}
        </Button>
      </DialogFooter>
    </form>
  );
}

type AuthPromptModalProps = { prompt: AuthPrompt };

/** `await AuthPromptModal.show({ prompt })` resolves to the answer, or null when dismissed. */
const AuthPromptModal = createModal<AuthPromptModalProps, string | null>(
  "auth-prompt",
  ({ prompt, modal }) => (
    <Dialog open={modal.visible} onOpenChange={(open) => !open && modal.resolve(null)}>
      <DialogContent showCloseButton={false}>
        <PromptForm
          key={prompt.promptId}
          prompt={prompt}
          onSubmit={(value) => modal.resolve(value)}
          onCancel={() => modal.resolve(null)}
        />
      </DialogContent>
    </Dialog>
  ),
);

/** Prompts the agent withdrew (`auth_prompt_closed`) while they were still waiting in line. */
const withdrawn = new Set<string>();
/** The question on screen, and how to dismiss it when the agent withdraws it. */
let onScreen: { promptId: string; dismiss: () => void } | null = null;
/** Sign-in questions are answered one at a time, in arrival order. */
let queue: Promise<void> = Promise.resolve();

/** Asks the person a sign-in question (API key, MCP code) from the agent and sends the answer back. */
export function askAuthPrompt(bridge: DesktopBridge, prompt: AuthPrompt): void {
  queue = queue.then(async () => {
    if (withdrawn.delete(prompt.promptId)) return;
    const answer = await new Promise<{ value: string | null } | "withdrawn">((resolve) => {
      onScreen = { promptId: prompt.promptId, dismiss: () => resolve("withdrawn") };
      AuthPromptModal.show({ prompt }).then(
        (value) => resolve({ value }),
        () => resolve({ value: null }),
      );
    });
    onScreen = null;
    // The agent closed it itself: nothing is waiting for an answer.
    if (answer === "withdrawn") return;
    bridge.agent
      .command({ type: "respond_auth_prompt", promptId: prompt.promptId, value: answer.value })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      );
  });
}

/** The agent closed the question itself (e.g. the sign-in was cancelled elsewhere). */
export function withdrawAuthPrompt(promptId: string): void {
  if (onScreen?.promptId === promptId) {
    onScreen.dismiss();
    AuthPromptModal.hide();
  } else {
    withdrawn.add(promptId);
  }
}
