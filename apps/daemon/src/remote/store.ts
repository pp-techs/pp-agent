import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { REMOTE_DEFAULT_PORT } from "@workspace/shared";

/** A paired device as `remote.json` keeps it: only a hash of its secret is stored. */
export interface StoredDevice {
  id: string;
  name: string;
  /** SHA-256 of the secret, hex. */
  secretHash: string;
  pairedAt: number;
  lastSeenAt: number;
}

interface RemoteFile {
  enabled: boolean;
  port: number;
  devices: StoredDevice[];
}

/** Longest device name kept; the browser picks it, so it is cut rather than refused. */
export const MAX_DEVICE_NAME = 60;
/** Most devices kept; pairing one more signs out the one seen least recently. */
export const MAX_DEVICES = 20;
/** `lastSeenAt` is written to disk at most this often per device; it is kept in memory meanwhile. */
const TOUCH_SAVE_MS = 60_000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function validPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function cleanName(name: string): string {
  // Control characters and surrounding space never belong in a label.
  const clean = name.replace(/\p{Cc}/gu, "").trim();
  return clean.slice(0, MAX_DEVICE_NAME);
}

function parseDevice(value: unknown): StoredDevice | null {
  if (!value || typeof value !== "object") return null;
  const device = value as Partial<StoredDevice>;
  if (
    typeof device.id !== "string" ||
    typeof device.name !== "string" ||
    typeof device.secretHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(device.secretHash) ||
    typeof device.pairedAt !== "number" ||
    typeof device.lastSeenAt !== "number"
  )
    return null;
  return {
    id: device.id,
    name: device.name,
    secretHash: device.secretHash,
    pairedAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt,
  };
}

/**
 * `remote.json` in the data folder (mode 0600): whether the web app is served, on which port, and
 * the paired devices. A device signs in with `<id>.<secret>`; the daemon keeps only the hash.
 */
export class RemoteStore {
  private data: RemoteFile = { enabled: false, port: REMOTE_DEFAULT_PORT, devices: [] };
  /** Last `lastSeenAt` written per device, so touching it does not write the file every request. */
  private readonly savedSeen = new Map<string, number>();
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  /** Reads the file; a missing or broken one means off, the default port, no devices. */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    let parsed: Partial<RemoteFile>;
    try {
      parsed = JSON.parse(raw) as Partial<RemoteFile>;
    } catch {
      return;
    }
    this.data = {
      enabled: parsed.enabled === true,
      port: validPort(parsed.port) ? parsed.port : REMOTE_DEFAULT_PORT,
      devices: Array.isArray(parsed.devices)
        ? parsed.devices.map(parseDevice).filter((device) => device !== null)
        : [],
    };
    for (const device of this.data.devices) this.savedSeen.set(device.id, device.lastSeenAt);
  }

  get enabled(): boolean {
    return this.data.enabled;
  }

  get port(): number {
    return this.data.port;
  }

  get devices(): readonly StoredDevice[] {
    return this.data.devices;
  }

  async configure(enabled: boolean, port: number): Promise<void> {
    this.data.enabled = enabled;
    this.data.port = port;
    await this.save();
  }

  /**
   * Adds a device and returns the token it signs in with (the token is not stored), and the ids of
   * devices it pushed out of the list.
   */
  async addDevice(
    name: string,
    now: number,
  ): Promise<{ device: StoredDevice; token: string; evicted: string[] }> {
    const secret = randomBytes(32).toString("hex");
    const device: StoredDevice = {
      id: randomUUID(),
      name: cleanName(name),
      secretHash: sha256(secret),
      pairedAt: now,
      lastSeenAt: now,
    };
    const devices = [...this.data.devices, device];
    // The oldest sign-ins go first when there are too many.
    devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    this.data.devices = devices.slice(0, MAX_DEVICES);
    const evicted = devices.slice(MAX_DEVICES).map((old) => old.id);
    for (const id of evicted) this.savedSeen.delete(id);
    this.savedSeen.set(device.id, now);
    await this.save();
    return { device, token: `${device.id}.${secret}`, evicted };
  }

  /** The device a token belongs to, or null; the comparison takes the same time either way. */
  authenticate(token: string | null): StoredDevice | null {
    if (!token) return null;
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const id = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (!/^[0-9a-f]{64}$/.test(secret)) return null;
    const device = this.data.devices.find((candidate) => candidate.id === id);
    const given = Buffer.from(sha256(secret), "hex");
    const expected = Buffer.from(device?.secretHash ?? "0".repeat(64), "hex");
    return timingSafeEqual(given, expected) && device ? device : null;
  }

  async removeDevice(id: string): Promise<boolean> {
    const before = this.data.devices.length;
    this.data.devices = this.data.devices.filter((device) => device.id !== id);
    if (this.data.devices.length === before) return false;
    this.savedSeen.delete(id);
    await this.save();
    return true;
  }

  /** Records that a device made a request. */
  touch(device: StoredDevice, now: number): void {
    device.lastSeenAt = now;
    if (now - (this.savedSeen.get(device.id) ?? 0) < TOUCH_SAVE_MS) return;
    this.savedSeen.set(device.id, now);
    this.save().catch(() => undefined);
  }

  /** Writes are queued, each one whole (temporary file, then rename). */
  private save(): Promise<void> {
    const next = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      await chmod(temporary, 0o600).catch(() => undefined);
      await rename(temporary, this.file);
    });
    this.writing = next.catch(() => undefined);
    return next;
  }
}
