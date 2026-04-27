const KEY = 'gitclip.sessionId';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

function randomId(len = 32): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(KEY);
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
  const fresh = randomId();
  localStorage.setItem(KEY, fresh);
  return fresh;
}

export function rotateSessionId(): string {
  const fresh = randomId();
  localStorage.setItem(KEY, fresh);
  return fresh;
}
