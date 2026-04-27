const API = 'https://api.github.com';

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface Branch {
  name: string;
  sha: string;
  isDefault: boolean;
}

export interface Commit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string;
  parents: string[];
}

export interface CompareFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  previous_filename?: string;
  sha?: string;
}

export class GitHubError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function authHeaders(pat?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (pat) h.authorization = `Bearer ${pat}`;
  return h;
}

async function ghFetch<T>(path: string, pat?: string | null, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(pat), ...(init.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubError(res.status, `${res.status} ${res.statusText} on ${path} — ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function parseRepoUrl(input: string): RepoRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const slashMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (slashMatch) return { owner: slashMatch[1]!, repo: slashMatch[2]! };
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const parts = url.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] };
    }
  } catch {
    return null;
  }
  return null;
}

export async function getRepoMeta(ref: RepoRef, pat?: string | null): Promise<{ defaultBranch: string }> {
  const data = await ghFetch<{ default_branch: string }>(`/repos/${ref.owner}/${ref.repo}`, pat);
  return { defaultBranch: data.default_branch };
}

export async function listBranches(ref: RepoRef, pat?: string | null): Promise<Branch[]> {
  const meta = await getRepoMeta(ref, pat);
  const data = await ghFetch<{ name: string; commit: { sha: string } }[]>(
    `/repos/${ref.owner}/${ref.repo}/branches?per_page=100`,
    pat,
  );
  return data.map((b) => ({ name: b.name, sha: b.commit.sha, isDefault: b.name === meta.defaultBranch }));
}

export async function listCommits(
  ref: RepoRef,
  branch: string,
  pat?: string | null,
  perPage = 30,
): Promise<Commit[]> {
  const data = await ghFetch<
    {
      sha: string;
      commit: { message: string; author: { name: string; email: string; date: string } };
      parents: { sha: string }[];
    }[]
  >(`/repos/${ref.owner}/${ref.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`, pat);
  return data.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    authorName: c.commit.author?.name ?? '',
    authorEmail: c.commit.author?.email ?? '',
    date: c.commit.author?.date ?? '',
    parents: c.parents.map((p) => p.sha),
  }));
}

export async function getBranchHead(
  ref: RepoRef,
  branch: string,
  pat: string | null | undefined,
  etag: string | null,
): Promise<{ sha: string; etag: string | null } | null> {
  const headers: Record<string, string> = { ...authHeaders(pat) };
  if (etag) headers['if-none-match'] = etag;
  const res = await fetch(`${API}/repos/${ref.owner}/${ref.repo}/branches/${encodeURIComponent(branch)}`, {
    headers,
  });
  if (res.status === 304) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubError(res.status, `${res.status} on branches/${branch} — ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { commit: { sha: string } };
  return { sha: data.commit.sha, etag: res.headers.get('etag') };
}

export interface CompareResult {
  files: CompareFile[];
  truncated: boolean;
  totalFiles: number;
}

export async function compareCommits(
  ref: RepoRef,
  base: string,
  head: string,
  pat?: string | null,
): Promise<CompareResult> {
  const data = await ghFetch<{
    files?: CompareFile[];
    total_commits?: number;
  }>(
    `/repos/${ref.owner}/${ref.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    pat,
  );
  const files = data.files ?? [];
  return { files, truncated: files.length === 300, totalFiles: files.length };
}

function decodeBase64(s: string): Uint8Array {
  const cleaned = s.replace(/\s/g, '');
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function getFileContent(
  ref: RepoRef,
  path: string,
  sha: string,
  blobSha: string | undefined,
  pat?: string | null,
): Promise<Uint8Array> {
  // Primary: contents API — works up to 1MB.
  try {
    const data = await ghFetch<{ content: string; encoding: string; size: number }>(
      `/repos/${ref.owner}/${ref.repo}/contents/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}?ref=${encodeURIComponent(sha)}`,
      pat,
    );
    if (data.encoding === 'base64' && data.content) return decodeBase64(data.content);
  } catch (err) {
    if (!(err instanceof GitHubError) || (err.status !== 403 && err.status !== 404)) throw err;
  }
  // Fallback: git blob API by sha — handles >1MB files.
  if (!blobSha) {
    throw new GitHubError(0, `cannot fetch ${path} at ${sha} (no blob sha for fallback)`);
  }
  const blob = await ghFetch<{ content: string; encoding: string }>(
    `/repos/${ref.owner}/${ref.repo}/git/blobs/${blobSha}`,
    pat,
  );
  if (blob.encoding !== 'base64') throw new GitHubError(0, `unexpected blob encoding ${blob.encoding}`);
  return decodeBase64(blob.content);
}
