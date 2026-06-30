import { useSyncExternalStore } from "react";

// Minimal confirm-dialog store, same pub/sub shape as the toast store.
// Callers `await confirm(...)` and get back true/false, so a delete is just:
//   if (await confirm({...})) await db.table.delete(id);
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

let current: ConfirmRequest | null = null;
const listeners = new Set<() => void>();
let nextId = 1;

function emit(): void {
  for (const l of listeners) l();
}

/** Open a confirmation dialog. Resolves true if confirmed, false otherwise. */
export function confirm(opts: ConfirmOptions | string): Promise<boolean> {
  const options = typeof opts === "string" ? { message: opts } : opts;
  // Only one dialog at a time — supersede any pending one as a cancel.
  if (current) current.resolve(false);
  return new Promise<boolean>((resolve) => {
    current = { id: nextId++, ...options, resolve };
    emit();
  });
}

/** Called by the dialog UI to close with a result. */
export function resolveConfirm(ok: boolean): void {
  if (!current) return;
  current.resolve(ok);
  current = null;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): ConfirmRequest | null {
  return current;
}

export function useConfirm(): ConfirmRequest | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
