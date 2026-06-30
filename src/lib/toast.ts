import { useSyncExternalStore } from "react";

// Minimal toast store. Plain pub/sub (no React dependency for producers) so the
// data layer can raise a toast on a failed write without importing UI code.
export type ToastType = "error" | "success" | "info";
export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit(): void {
  for (const l of listeners) l();
}

/** Show a toast; auto-dismisses after `ttl` ms (0 = sticky). Returns its id. */
export function pushToast(message: string, type: ToastType = "info", ttl = 6000): number {
  const id = nextId++;
  toasts = [...toasts, { id, message, type }];
  emit();
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl);
  return id;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): Toast[] {
  return toasts;
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
