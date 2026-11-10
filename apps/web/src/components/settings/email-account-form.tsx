import * as React from "react";
import { EMAIL_PROVIDERS, type DesktopBridge, type EmailAccountSettings } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { ArrowLeftIcon, ExternalLinkIcon, PlugZapIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { OptionGroup, SwitchRow } from "@/components/settings/option-group";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import {
  emailAccountName,
  emailAccountFromDraft,
  draftOf,
  withProvider,
  type EmailDraft,
} from "@/lib/email-form";
import { useSaveEmailAccount, useTestEmailAccount } from "@/lib/extension-queries";

/** In-pane form for one mailbox (`account` omitted adds one). */
export function EmailAccountForm({
  bridge,
  account,
  existingNames,
  onDone,
}: {
  bridge: DesktopBridge;
  account?: EmailAccountSettings;
  existingNames: string[];
  onDone: () => void;
}) {
  const { t } = useTranslation(["extensions", "common"]);
  const [draft, setDraft] = React.useState<EmailDraft>(() => draftOf(account));
  const [touched, setTouched] = React.useState(false);
  const save = useSaveEmailAccount(bridge);
  const test = useTestEmailAccount(bridge);
  useSettingsSubPage(account ? (account.label ?? account.address) : t("email.addTitle"));

  const providerItems = EMAIL_PROVIDERS.map((provider) => ({
    value: provider.id,
    label: provider.name,
  }));
  const provider = EMAIL_PROVIDERS.find((item) => item.id === draft.provider);
  const name =
    account?.name ??
    emailAccountName(
      draft.address,
      existingNames.filter((n) => n !== account?.name),
    );
  const parsed = emailAccountFromDraft(draft, name);
  const busy = save.isPending || test.isPending;
  const set = <K extends keyof EmailDraft>(key: K, value: EmailDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if ("error" in parsed) return;
    try {
      await save.mutateAsync({
        originalName: account?.name,
        account: parsed.account,
        ...(draft.password !== "" ? { password: draft.password } : {}),
      });
      toast.success(
        t("email.toast.saved", { name: parsed.account.label ?? parsed.account.address }),
      );
      // Saving is not connecting: say now whether the password works for both servers.
      const result = await test.mutateAsync(parsed.account.name).catch(() => null);
      if (result?.ok) toast.success(t("email.toast.connected"));
      else if (result?.error) toast.error(result.error);
      onDone();
    } catch {
      // The mutation already showed the error.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t("email.back")} onClick={onDone}>
          <ArrowLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-base font-medium">
            {account
              ? t("email.editTitle", { name: account.label ?? account.address })
              : t("email.addTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("email.intro")}</p>
        </div>
      </header>
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <FieldGroup>
          <Field>
            <FieldLabel>{t("email.fields.provider.label")}</FieldLabel>
            <Select
              items={providerItems}
              value={draft.provider}
              onValueChange={(value) =>
                value && setDraft((current) => withProvider(current, value))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field data-invalid={touched && "error" in parsed && parsed.error === "address"}>
            <FieldLabel htmlFor="email-address">{t("email.fields.address.label")}</FieldLabel>
            <Input
              id="email-address"
              type="email"
              value={draft.address}
              onChange={(event) => set("address", event.target.value)}
              placeholder="ten@congty.com"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={touched && "error" in parsed && parsed.error === "address"}
            />
            {touched && "error" in parsed && parsed.error === "address" ? (
              <FieldError>{t("email.validation.address")}</FieldError>
            ) : (
              <FieldDescription>{t("email.fields.address.hint")}</FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="email-label">{t("email.fields.label.label")}</FieldLabel>
            <Input
              id="email-label"
              value={draft.label}
              onChange={(event) => set("label", event.target.value)}
              placeholder={t("email.fields.label.placeholder")}
            />
            <FieldDescription>{t("email.fields.label.hint")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="email-display-name">
              {t("email.fields.displayName.label")}
            </FieldLabel>
            <Input
              id="email-display-name"
              value={draft.displayName}
              onChange={(event) => set("displayName", event.target.value)}
              placeholder={t("email.fields.displayName.placeholder")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email-password">{t("email.fields.password.label")}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="email-password"
                type="password"
                value={draft.password}
                onChange={(event) => set("password", event.target.value)}
                placeholder={account ? t("email.fields.password.keep") : "••••••••"}
                autoComplete="new-password"
                aria-label={t("email.fields.password.label")}
              />
              {provider?.passwordHelpUrl && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    bridge
                      .openExternal(provider.passwordHelpUrl!)
                      .catch((error: Error) => toast.error(error.message))
                  }
                >
                  <ExternalLinkIcon />
                  {t("email.fields.password.create")}
                </Button>
              )}
            </div>
            <FieldDescription>{t("email.fields.password.hint")}</FieldDescription>
          </Field>

          <OptionGroup
            legend={t("email.servers.legend")}
            description={t("email.servers.description")}
          >
            <div className="flex flex-col gap-3">
              <Field data-invalid={touched && "error" in parsed && parsed.error === "imap"}>
                <FieldLabel htmlFor="email-imap-host">{t("email.fields.imap.label")}</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="email-imap-host"
                    value={draft.imapHost}
                    onChange={(event) => set("imapHost", event.target.value)}
                    placeholder="imap.congty.com"
                    spellCheck={false}
                    className="flex-1 font-mono"
                  />
                  <Input
                    value={draft.imapPort}
                    onChange={(event) => set("imapPort", event.target.value)}
                    inputMode="numeric"
                    aria-label={t("email.fields.port")}
                    className="w-20 font-mono"
                  />
                </div>
              </Field>
              <SwitchRow
                id="email-imap-secure"
                label={t("email.fields.secure.imap")}
                description={t("email.fields.secure.imapHint")}
                checked={draft.imapSecure}
                onCheckedChange={(value) => set("imapSecure", value)}
              />
              <Field data-invalid={touched && "error" in parsed && parsed.error === "smtp"}>
                <FieldLabel htmlFor="email-smtp-host">{t("email.fields.smtp.label")}</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="email-smtp-host"
                    value={draft.smtpHost}
                    onChange={(event) => set("smtpHost", event.target.value)}
                    placeholder="smtp.congty.com"
                    spellCheck={false}
                    className="flex-1 font-mono"
                  />
                  <Input
                    value={draft.smtpPort}
                    onChange={(event) => set("smtpPort", event.target.value)}
                    inputMode="numeric"
                    aria-label={t("email.fields.port")}
                    className="w-20 font-mono"
                  />
                </div>
              </Field>
              <SwitchRow
                id="email-smtp-secure"
                label={t("email.fields.secure.smtp")}
                description={t("email.fields.secure.smtpHint")}
                checked={draft.smtpSecure}
                onCheckedChange={(value) => set("smtpSecure", value)}
              />
              {touched && "error" in parsed && parsed.error === "port" && (
                <FieldError>{t("email.validation.port")}</FieldError>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground">
              <p>{t("email.servers.note")}</p>
            </div>
          </OptionGroup>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            {t("common:actions.cancel")}
          </Button>
          <Button type="submit" disabled={busy || (touched && "error" in parsed)}>
            {busy ? <Spinner /> : <PlugZapIcon />}
            {account ? t("saveChanges") : t("email.add")}
          </Button>
        </div>
      </form>
    </div>
  );
}
