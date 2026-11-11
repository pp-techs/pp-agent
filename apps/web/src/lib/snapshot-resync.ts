import type { AgentSnapshot } from "@workspace/shared";

/**
 * Asks for a fresh snapshot of the chat when this window missed something, and uses the answer only
 * if no other snapshot reached the window while it was on its way: a newer one is the truth, and an
 * older answer would overwrite it. A request made while one is in flight, or an answer that was
 * overtaken, asks again once, so what was missed is still put right.
 */
export function createSnapshotResync(
  fetchSnapshot: () => Promise<AgentSnapshot>,
  apply: (snapshot: AgentSnapshot) => void,
) {
  let received = 0;
  let inFlight = false;
  let again = false;

  const request = (): void => {
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    const asked = received;
    fetchSnapshot()
      .then((snapshot) => {
        if (received === asked) {
          received += 1;
          apply(snapshot);
        } else again = true;
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        if (again) {
          again = false;
          request();
        }
      });
  };

  return {
    request,
    /** A snapshot that replaced the chat reached the window by another way. */
    received: () => {
      received += 1;
    },
  };
}
