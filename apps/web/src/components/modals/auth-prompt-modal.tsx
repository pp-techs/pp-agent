import * as React from "react";
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
import { create } from "zustand";

import { useRespondAuthPrompt } from "@/lib/queries";

interface AuthPromptState {
  /** Questions from sign-in flows, answered one at a time in arrival order. */
  queue: AuthPrompt[];
  push: (prompt: AuthPrompt) => void;
  remove: (promptId: string) => void;
}

export const useAuthPromptStore = create<AuthPromptState>()((set) => ({
  queue: [],
  push: (prompt) =>
    set((state) => ({
      queue: [...state.queue.filter((item) => item.promptId !== prompt.promptId), prompt],
    })),
  remove: (promptId) =>
    set((state) => ({ queue: state.queue.filter((item) => item.promptId !== promptId) })),
}));

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

/** Shows sign-in questions (API keys, MCP codes) from the agent, one at a time. */
export function AuthPromptModal({ bridge }: { bridge: DesktopBridge }) {
  const prompt = useAuthPromptStore((state) => state.queue[0]);
  const respond = useRespondAuthPrompt(bridge);

  function answer(value: string | null) {
    if (!prompt) return;
    // The agent also sends `auth_prompt_closed`; removing now keeps the dialog responsive.
    useAuthPromptStore.getState().remove(prompt.promptId);
    respond.mutate(
      { promptId: prompt.promptId, value },
      { onError: (error) => toast.error(error.message) },
    );
  }

  return (
    <Dialog open={prompt !== undefined} onOpenChange={(open) => !open && answer(null)}>
      <DialogContent showCloseButton={false}>
        {prompt && (
          <PromptForm
            key={prompt.promptId}
            prompt={prompt}
            onSubmit={answer}
            onCancel={() => answer(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
