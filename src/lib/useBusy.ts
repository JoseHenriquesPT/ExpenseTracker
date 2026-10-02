import { useRef, useState } from "react";

/**
 * Guards an async action against double submission: while `run` is in flight,
 * `busy` is true and further `run` calls are ignored, so a fast double-click
 * can't insert two rows or record two settlements.
 */
export function useBusy(): {
  busy: boolean;
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
} {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { busy, run };
}
