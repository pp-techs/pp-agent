import type { AgentEvent, ServiceStatus, StoredCredential } from "@workspace/shared";

/** Where the host sends what it produces. The daemon forwards it to every connected client. */
export interface HostOutput {
  emit(event: AgentEvent): void;
  /** Asks a client to open an http(s) URL in a browser (provider or MCP OAuth sign-in). */
  openUrl(url: string): void;
}

/**
 * Where provider credentials, search keys and MCP OAuth state are kept. `StoredCredential` ids
 * are provider ids or prefixed keys (`websearch:`, `mcp-auth:`, `channel:`).
 */
export interface VaultBackend {
  read(id: string): Promise<StoredCredential | null>;
  list(): Promise<string[]>;
  write(id: string, credential: StoredCredential): Promise<void>;
  delete(id: string): Promise<void>;
  /** Whether stored secrets are really protected (OS keyring, or a master key outside the data folder). */
  available(): Promise<boolean>;
}

/** Registers the daemon with the OS so it starts at login and keeps running without the window. */
export interface ServiceControl {
  status(): Promise<ServiceStatus>;
  install(): Promise<void>;
  uninstall(): Promise<void>;
}

/** Everything the host needs from the process that runs it. */
export interface HostEnvironment {
  output: HostOutput;
  vault: VaultBackend;
  service: ServiceControl;
}
