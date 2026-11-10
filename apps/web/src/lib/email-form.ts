import { EMAIL_PROVIDERS, type EmailAccountSettings } from "@workspace/shared";

/** What the email form holds before it is saved. */
export interface EmailDraft {
  provider: string;
  address: string;
  label: string;
  displayName: string;
  password: string;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  imapUser: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
}

export function draftOf(account?: EmailAccountSettings): EmailDraft {
  const provider = account ? providerOf(account) : (EMAIL_PROVIDERS[0]?.id ?? "custom");
  const preset = EMAIL_PROVIDERS.find((item) => item.id === provider);
  return {
    provider,
    address: account?.address ?? "",
    label: account?.label ?? "",
    displayName: account?.displayName ?? "",
    password: "",
    imapHost: account?.imap.host ?? preset?.imap.host ?? "",
    imapPort: String(account?.imap.port ?? preset?.imap.port ?? 993),
    imapSecure: account?.imap.secure ?? preset?.imap.secure ?? true,
    imapUser: account?.imap.user ?? "",
    smtpHost: account?.smtp.host ?? preset?.smtp.host ?? "",
    smtpPort: String(account?.smtp.port ?? preset?.smtp.port ?? 465),
    smtpSecure: account?.smtp.secure ?? preset?.smtp.secure ?? true,
    smtpUser: account?.smtp.user ?? "",
  };
}

/** The provider whose servers the account already uses, so editing keeps the right preset. */
function providerOf(account: EmailAccountSettings): string {
  const match = EMAIL_PROVIDERS.find(
    (item) =>
      item.id !== "custom" &&
      item.imap.host.toLowerCase() === account.imap.host.toLowerCase() &&
      item.smtp.host.toLowerCase() === account.smtp.host.toLowerCase(),
  );
  return match?.id ?? "custom";
}

/** Switching provider fills in that provider's servers and leaves the rest of the form alone. */
export function withProvider(draft: EmailDraft, provider: string): EmailDraft {
  const preset = EMAIL_PROVIDERS.find((item) => item.id === provider);
  if (!preset) return { ...draft, provider };
  return {
    ...draft,
    provider,
    imapHost: preset.imap.host,
    imapPort: String(preset.imap.port),
    imapSecure: preset.imap.secure,
    smtpHost: preset.smtp.host,
    smtpPort: String(preset.smtp.port),
    smtpSecure: preset.smtp.secure,
  };
}

/** `nhat@monback.app` → `nhat`; `-2`, `-3`… when another mailbox already has that name. */
export function emailAccountName(address: string, taken: readonly string[]): string {
  const local = address.split("@")[0] ?? "";
  const base =
    local
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "mail";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** The account to save, or the first thing the form has to fix. */
export function emailAccountFromDraft(
  draft: EmailDraft,
  name: string,
): { account: EmailAccountSettings } | { error: "address" | "imap" | "smtp" | "port" } {
  const address = draft.address.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) return { error: "address" };
  const imapHost = draft.imapHost.trim();
  const smtpHost = draft.smtpHost.trim();
  if (imapHost === "") return { error: "imap" };
  if (smtpHost === "") return { error: "smtp" };
  const imapPort = Number(draft.imapPort);
  const smtpPort = Number(draft.smtpPort);
  if (!validPort(imapPort) || !validPort(smtpPort)) return { error: "port" };
  return {
    account: {
      name,
      ...(draft.label.trim() ? { label: draft.label.trim() } : {}),
      address,
      ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}),
      imap: {
        host: imapHost,
        port: imapPort,
        secure: draft.imapSecure,
        ...(draft.imapUser.trim() ? { user: draft.imapUser.trim() } : {}),
      },
      smtp: {
        host: smtpHost,
        port: smtpPort,
        secure: draft.smtpSecure,
        ...(draft.smtpUser.trim() ? { user: draft.smtpUser.trim() } : {}),
      },
    },
  };
}

function validPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}
