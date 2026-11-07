/**
 * Wrong pairing codes one source address may send before it is locked out on its own. Lower than
 * `PairingGuard`'s global limit (five), so a single client on the network cannot lock pairing for
 * everyone; the global limit still bounds guessing from many addresses together.
 */
export const PAIR_ATTEMPTS_PER_ADDRESS = 3;
/** Same length as the global lock; starting a new pairing on the computer lifts both. */
export const PAIR_ADDRESS_LOCK_MS = 15 * 60_000;
/** Addresses remembered at once; the oldest are forgotten first. */
const MAX_ADDRESSES = 256;

interface Failures {
  count: number;
  lockedUntil: number;
}

/** Wrong pairing codes counted per source address. */
export class AddressLockout {
  private readonly failures = new Map<string, Failures>();

  locked(address: string, now: number): boolean {
    const entry = this.failures.get(address);
    return entry !== undefined && now < entry.lockedUntil;
  }

  /** Counts a wrong code; true when this address is now locked out. */
  failed(address: string, now: number): boolean {
    const entry = this.failures.get(address) ?? { count: 0, lockedUntil: 0 };
    // Re-inserted so the map stays in order of the latest failure.
    this.failures.delete(address);
    entry.count++;
    const locked = entry.count >= PAIR_ATTEMPTS_PER_ADDRESS;
    if (locked) {
      entry.count = 0;
      entry.lockedUntil = now + PAIR_ADDRESS_LOCK_MS;
    }
    this.failures.set(address, entry);
    for (const oldest of this.failures.keys()) {
      if (this.failures.size <= MAX_ADDRESSES) break;
      this.failures.delete(oldest);
    }
    return locked;
  }

  succeeded(address: string): void {
    this.failures.delete(address);
  }

  clear(): void {
    this.failures.clear();
  }
}
