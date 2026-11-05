import type {
  AgentEvent,
  BrowserRequest,
  BrowserResult,
  ComputerRequest,
  ComputerResult,
  RemoteAccessStatus,
  ServiceStatus,
  StoredCredential,
} from "@workspace/shared";

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

/**
 * The browser the agent's `browser` tool drives: the side panel browser of a connected window. A
 * headless browser the daemon starts itself could answer here too, for runs without a window.
 */
export interface BrowserBridge {
  /** Whether a browser can take requests right now. */
  available(): boolean;
  /** Runs one tool call; rejects with a message the model can act on. */
  request(request: BrowserRequest, signal?: AbortSignal): Promise<BrowserResult>;
}

/**
 * Where the agent's `computer` tool runs: the window, which starts cua-driver itself so macOS
 * attributes its Accessibility and Screen Recording use to PP Agent.
 */
export interface ComputerBridge {
  /** Whether a window with cua-driver can take requests right now. */
  available(): boolean;
  /** Runs one tool call; rejects with a message the model can act on. */
  request(request: ComputerRequest, signal?: AbortSignal): Promise<ComputerResult>;
}

/** Everything the host needs from the process that runs it. */
/**
 * The web app the daemon serves on the local network (Settings › Phone access). The daemon owns
 * the listener, the pairing code and the paired devices; the host only relays the commands.
 */
export interface RemoteAccessControl {
  status(): Promise<RemoteAccessStatus>;
  /** `port` omitted keeps the current one. */
  set(enabled: boolean, port?: number): Promise<RemoteAccessStatus>;
  startPairing(): Promise<RemoteAccessStatus>;
  forgetDevice(id: string): Promise<RemoteAccessStatus>;
}

export interface HostEnvironment {
  output: HostOutput;
  vault: VaultBackend;
  service: ServiceControl;
  /** Absent where nothing serves the web app (tests, an embedded host). */
  remote?: RemoteAccessControl;
  /** Absent where nothing can show a browser (tests, a host without clients). */
  browser?: BrowserBridge;
  /** Absent where no window can drive apps (tests, a host without clients). */
  computer?: ComputerBridge;
}
