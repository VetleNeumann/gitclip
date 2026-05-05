export type ParseResult = { ok: true; sha: string } | { ok: false; reason: string };

export function parseAnchorSha(input: string): ParseResult {
  const sha = input.trim().toLowerCase();
  if (!sha) return { ok: false, reason: 'Empty input.' };
  if (!/^[0-9a-f]+$/.test(sha)) return { ok: false, reason: 'Not a valid sha (expected hex characters only).' };
  if (sha.length < 7) return { ok: false, reason: 'Sha is too short (need at least 7 characters).' };
  if (sha.length > 40) return { ok: false, reason: 'Sha is too long (max 40 characters).' };
  return { ok: true, sha };
}
