const COPIED_PREFIX = 'gitclip.copied.';
const COPIED_VALUE = '1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function copiedCommandKey(id: string): string {
  return `${COPIED_PREFIX}${id}`;
}

export function wasCommandCopied(id: string, storage?: StorageLike): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    return target.getItem(copiedCommandKey(id)) === COPIED_VALUE;
  } catch {
    return false;
  }
}

export function markCommandCopied(id: string, storage?: StorageLike): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(copiedCommandKey(id), COPIED_VALUE);
  } catch {
    // Ignore storage write failures to keep copy UX non-blocking.
  }
}

export function clearCommandCopied(id: string, storage?: StorageLike): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.removeItem(copiedCommandKey(id));
  } catch {
    // Ignore storage delete failures to keep dismiss UX non-blocking.
  }
}

export function listCopiedCommandIds(ids: readonly string[], storage?: StorageLike): Set<string> {
  const copied = new Set<string>();
  for (const id of ids) {
    if (wasCommandCopied(id, storage)) copied.add(id);
  }
  return copied;
}
