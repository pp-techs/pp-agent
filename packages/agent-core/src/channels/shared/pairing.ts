import { randomInt, timingSafeEqual } from "node:crypto";

/** No 0/O or 1/I/L, which are easy to misread when typing a code from one screen into another. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
export const PAIRING_TTL_MS = 10 * 60_000;
export const PAIRING_LOCK_MS = 15 * 60_000;
export const PAIRING_MAX_ATTEMPTS = 5;
/** Wrong codes one sender may try before only that sender is locked out. */
export const PAIRING_MAX_SENDER_ATTEMPTS = 3;
/** Senders remembered at once; the oldest entry goes first beyond this. */
const MAX_TRACKED_SENDERS = 1_000;

export type PairingResult =
  | { status: "ok" }
  /** The code is wrong or expired while a pairing is open. */
  | { status: "invalid" }
  /** No pairing is open. */
  | { status: "closed" }
  | { status: "locked"; until: number };

/**
 * One-time pairing codes. A code is valid for ten minutes and for one successful use; five wrong
 * guesses from anyone lock the guard for fifteen minutes, so a code cannot be brute-forced. A
 * sender (a chat app user id) that gets three wrong is locked out alone for fifteen minutes first,
 * so one stranger cannot use up the attempts and lock the owner out.
 */
export class PairingGuard {
  private code: string | null = null;
  private expiresAt = 0;
  private failures = 0;
  private lockedUntil = 0;
  private readonly senders = new Map<string, { failures: number; lockedUntil: number }>();

  /** Opens a pairing window. Only the local person can do this, so it also lifts a lockout. */
  open(now: number): { code: string; expiresAt: number } {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
    this.code = code;
    this.expiresAt = now + PAIRING_TTL_MS;
    this.failures = 0;
    this.lockedUntil = 0;
    this.senders.clear();
    return { code, expiresAt: this.expiresAt };
  }

  close(): void {
    this.code = null;
    this.expiresAt = 0;
  }

  /** The open code, or null when none is open or it has expired. */
  current(now: number): { code: string; expiresAt: number } | null {
    if (this.code === null || now >= this.expiresAt) return null;
    return { code: this.code, expiresAt: this.expiresAt };
  }

  isOpen(now: number): boolean {
    return this.current(now) !== null;
  }

  /** `sender` (the chat app's user id) counts that sender's wrong codes too. */
  attempt(guess: string, now: number, sender?: string): PairingResult {
    if (now < this.lockedUntil) return { status: "locked", until: this.lockedUntil };
    const own = sender === undefined ? undefined : this.senders.get(sender);
    if (own && now < own.lockedUntil) return { status: "locked", until: own.lockedUntil };
    const open = this.current(now);
    if (!open) {
      this.close();
      return { status: "closed" };
    }
    const given = Buffer.from(guess.toUpperCase().replace(/[\s-]/g, ""));
    const expected = Buffer.from(open.code);
    // Lengths must match for timingSafeEqual; comparing against itself keeps the work the same.
    const equal =
      given.length === expected.length
        ? timingSafeEqual(given, expected)
        : timingSafeEqual(expected, expected) && false;
    if (equal) {
      this.close();
      this.failures = 0;
      return { status: "ok" };
    }
    this.failures++;
    if (sender !== undefined) {
      // A sender whose lockout ran out starts again from zero (the count was reset at the lock).
      const failures = (own?.failures ?? 0) + 1;
      this.senders.delete(sender);
      if (this.senders.size >= MAX_TRACKED_SENDERS)
        this.senders.delete(this.senders.keys().next().value!);
      const locked = failures >= PAIRING_MAX_SENDER_ATTEMPTS;
      this.senders.set(sender, {
        failures: locked ? 0 : failures,
        lockedUntil: locked ? now + PAIRING_LOCK_MS : 0,
      });
      if (locked && this.failures < PAIRING_MAX_ATTEMPTS)
        return { status: "locked", until: now + PAIRING_LOCK_MS };
    }
    if (this.failures >= PAIRING_MAX_ATTEMPTS) {
      this.failures = 0;
      this.lockedUntil = now + PAIRING_LOCK_MS;
      return { status: "locked", until: this.lockedUntil };
    }
    return { status: "invalid" };
  }
}
