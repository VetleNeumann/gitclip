import { describe, expect, it } from 'vitest';
import {
  clearCommandCopied,
  copiedCommandKey,
  listCopiedCommandIds,
  markCommandCopied,
  wasCommandCopied,
  type StorageLike,
} from '../src/lib/commandCopied';

class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe('commandCopied persistence', () => {
  it('uses the expected key format', () => {
    expect(copiedCommandKey('abc-123')).toBe('gitclip.copied.abc-123');
  });

  it('marks, reads, and clears copied status', () => {
    const storage = new MemoryStorage();

    expect(wasCommandCopied('entry-1', storage)).toBe(false);

    markCommandCopied('entry-1', storage);
    expect(wasCommandCopied('entry-1', storage)).toBe(true);

    clearCommandCopied('entry-1', storage);
    expect(wasCommandCopied('entry-1', storage)).toBe(false);
  });

  it('lists copied ids only for entries still in the queue', () => {
    const storage = new MemoryStorage();

    markCommandCopied('entry-1', storage);
    markCommandCopied('entry-2', storage);

    expect([...listCopiedCommandIds(['entry-1', 'entry-3'], storage)]).toEqual(['entry-1']);
  });

  it('gracefully behaves when no storage is available', () => {
    expect(wasCommandCopied('entry-1')).toBe(false);
    expect([...listCopiedCommandIds(['entry-1'])]).toEqual([]);
  });

  it('gracefully behaves when localStorage access throws', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('localStorage blocked');
      },
    });

    try {
      expect(wasCommandCopied('entry-1')).toBe(false);
      expect([...listCopiedCommandIds(['entry-1'])]).toEqual([]);
      expect(() => markCommandCopied('entry-1')).not.toThrow();
      expect(() => clearCommandCopied('entry-1')).not.toThrow();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'localStorage');
      }
    }
  });
});
