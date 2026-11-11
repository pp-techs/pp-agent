import type { AgentSnapshot } from "@workspace/shared";
import { expect, it } from "vite-plus/test";

import { createSnapshotResync } from "./snapshot-resync";

const snapshot = (sessionPath: string) => ({ sessionPath }) as AgentSnapshot;

/** A snapshot request whose answers the test gives, one at a time. */
function harness() {
  const waiting: ((value: AgentSnapshot) => void)[] = [];
  const applied: string[] = [];
  const resync = createSnapshotResync(
    () => new Promise<AgentSnapshot>((resolve) => waiting.push(resolve)),
    (value) => applied.push(value.sessionPath ?? ""),
  );
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { waiting, applied, resync, tick };
}

it("applies the answer when nothing else arrived meanwhile", async () => {
  const { waiting, applied, resync, tick } = harness();
  resync.request();
  waiting[0]!(snapshot("a"));
  await tick();
  expect(applied).toEqual(["a"]);
});

it("drops an answer that a newer snapshot overtook, and asks again", async () => {
  const { waiting, applied, resync, tick } = harness();
  resync.request();
  // The user switched chats: a full snapshot of the new one reached the window first.
  resync.received();
  waiting[0]!(snapshot("old chat"));
  await tick();
  expect(applied).toEqual([]);
  expect(waiting).toHaveLength(2);
  waiting[1]!(snapshot("current"));
  await tick();
  expect(applied).toEqual(["current"]);
});

it("asks once more for a gap seen while a request is in flight", async () => {
  const { waiting, applied, resync, tick } = harness();
  resync.request();
  resync.request();
  resync.request();
  expect(waiting).toHaveLength(1);
  waiting[0]!(snapshot("a"));
  await tick();
  expect(waiting).toHaveLength(2);
  waiting[1]!(snapshot("b"));
  await tick();
  expect(applied).toEqual(["a", "b"]);
  expect(waiting).toHaveLength(2);
});

it("lets a later request through after a failed one", async () => {
  const applied: string[] = [];
  let calls = 0;
  const resync = createSnapshotResync(
    () => (++calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(snapshot("ok"))),
    (value) => applied.push(value.sessionPath ?? ""),
  );
  resync.request();
  await new Promise((resolve) => setTimeout(resolve, 0));
  resync.request();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(applied).toEqual(["ok"]);
});
