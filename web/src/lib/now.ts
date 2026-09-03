// One shared clock for every relative time on the page. Convex re-renders when
// data changes, never because time passed, so "3m ago" and an elapsed counter
// need their own tick. The server snapshot is null, which makes the first
// client render match SSR exactly and kills the hydration mismatch that
// Date.now()-in-render caused.

import { useSyncExternalStore } from "react";

export type Tier = 1000 | 30_000;

let current = Date.now();
const listeners = new Map<Tier, Set<() => void>>();
const timers = new Map<Tier, ReturnType<typeof setInterval>>();

function subscribeFor(tier: Tier) {
  return (callback: () => void) => {
    let set = listeners.get(tier);
    if (!set) {
      set = new Set();
      listeners.set(tier, set);
    }
    set.add(callback);
    if (!timers.has(tier)) {
      timers.set(
        tier,
        setInterval(() => {
          current = Date.now();
          for (const s of listeners.values()) for (const cb of s) cb();
        }, tier)
      );
    }
    // a fresh subscriber should not see a clock frozen at module load
    current = Date.now();
    return () => {
      set!.delete(callback);
      if (set!.size === 0) {
        clearInterval(timers.get(tier));
        timers.delete(tier);
      }
    };
  };
}

const subscribers: Record<Tier, (cb: () => void) => () => void> = {
  1000: subscribeFor(1000),
  30_000: subscribeFor(30_000),
};

/** the current time, ticking at the tier; null on the server and during hydration. */
export function useNow(tier: Tier = 30_000): number | null {
  return useSyncExternalStore(
    subscribers[tier],
    () => current,
    () => null
  );
}
