import { describe, expect, test } from "vite-plus/test";
import { PAIRING_LOCK_MS, PAIRING_TTL_MS, PairingGuard } from "./pairing.ts";

describe("PairingGuard", () => {
  test("opens an 8-character code from an unambiguous alphabet", () => {
    const guard = new PairingGuard();
    const { code, expiresAt } = guard.open(1000);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(expiresAt).toBe(1000 + PAIRING_TTL_MS);
    expect(guard.current(1000)?.code).toBe(code);
  });

  test("accepts the code once, ignoring case and spaces", () => {
    const guard = new PairingGuard();
    const { code } = guard.open(0);
    expect(guard.attempt(` ${code.toLowerCase().slice(0, 4)} ${code.slice(4)}`, 1)).toEqual({
      status: "ok",
    });
    expect(guard.attempt(code, 2)).toEqual({ status: "closed" });
    expect(guard.current(2)).toBeNull();
  });

  test("a code expires after ten minutes", () => {
    const guard = new PairingGuard();
    const { code } = guard.open(0);
    expect(guard.attempt(code, PAIRING_TTL_MS)).toEqual({ status: "closed" });
  });

  test("answers closed when nothing is open", () => {
    expect(new PairingGuard().attempt("ABCDEFGH", 0)).toEqual({ status: "closed" });
  });

  test("locks for 15 minutes after five wrong attempts, even for the right code", () => {
    const guard = new PairingGuard();
    const { code } = guard.open(0);
    for (let i = 0; i < 4; i++)
      expect(guard.attempt("WRONGCODE", i)).toEqual({ status: "invalid" });
    expect(guard.attempt("short", 4)).toEqual({ status: "locked", until: 4 + PAIRING_LOCK_MS });
    expect(guard.attempt(code, 5)).toEqual({ status: "locked", until: 4 + PAIRING_LOCK_MS });
  });

  test("opening a new pairing lifts the lockout", () => {
    const guard = new PairingGuard();
    guard.open(0);
    for (let i = 0; i < 5; i++) guard.attempt("WRONGCODE", i);
    const { code } = guard.open(10);
    expect(guard.attempt(code, 11)).toEqual({ status: "ok" });
  });

  test("a successful pairing resets the wrong-attempt count", () => {
    const guard = new PairingGuard();
    guard.open(0);
    guard.attempt("WRONGCODE", 1);
    const { code } = guard.open(2);
    expect(guard.attempt("WRONGCODE", 3)).toEqual({ status: "invalid" });
    expect(guard.attempt(code, 4)).toEqual({ status: "ok" });
  });
});
