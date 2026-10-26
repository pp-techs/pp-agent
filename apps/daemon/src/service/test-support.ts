import type { CommandResult, CommandRunner } from "./types.ts";

export type Responder = (file: string, args: string[]) => Partial<CommandResult> | undefined;

/** A runner that records every call and answers from `respond` (success when it returns nothing). */
export function fakeRunner(respond: Responder = () => undefined) {
  const calls: string[] = [];
  const runner: CommandRunner = async (file, args) => {
    calls.push([file, ...args].join(" "));
    return { code: 0, stdout: "", stderr: "", notFound: false, ...respond(file, args) };
  };
  return { runner, calls };
}
