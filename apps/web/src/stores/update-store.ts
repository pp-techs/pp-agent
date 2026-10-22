import type { DesktopBridge, UpdateState } from "@workspace/shared";
import { create } from "zustand";

interface UpdateStoreState {
  /** Null until the main process has answered. */
  update: UpdateState | null;
  set: (update: UpdateState) => void;
}

export const useUpdateStore = create<UpdateStoreState>()((set) => ({
  update: null,
  set: (update) => set({ update }),
}));

/** Mirrors the main process's update state into the store; returns the unsubscribe function. */
export function connectUpdates(bridge: DesktopBridge): () => void {
  const { set } = useUpdateStore.getState();
  const unsubscribe = bridge.updates.onState(set);
  bridge.updates
    .state()
    .then(set)
    .catch(() => undefined);
  return unsubscribe;
}
