import { useSyncExternalStore } from "react";

// Tracks the browser's online/offline state. navigator.onLine flips on the
// window 'online'/'offline' events; useSyncExternalStore keeps React in step.
function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true // server/SSR fallback (unused here, but required)
  );
}
