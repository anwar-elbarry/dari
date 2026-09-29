/**
 * Browser client for the same-origin /api proxy.
 * - Adds the CSRF header the API requires on state-changing requests.
 * - On an expired access token, refreshes the session once and retries the call.
 */
export interface FieldError {
  field: string;
  errors: string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: FieldError[],
  ) {
    super(message);
  }

  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details ?? []) out[d.field] = d.errors[0] ?? '';
    return out;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function raw(method: Method, path: string, body?: unknown): Promise<Response> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  return fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    // A FormData body sets its own multipart boundary header.
    headers: { 'X-Requested-With': 'dari', ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
}

async function toError(res: Response): Promise<ApiError> {
  const data = await res.json().catch(() => null);
  const e = data?.error;
  return new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? res.statusText, e?.details);
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time per tab. A REFRESH_RACE (another tab just refreshed) is retried once. */
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await raw('POST', '/auth/refresh');
      if (res.ok) return true;
      const err = await toError(res);
      if (err.code !== 'REFRESH_RACE') return false;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  let res = await raw(method, path, body);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const err = await toError(res.clone());
    if (err.code === 'UNAUTHENTICATED' && (await refreshSession())) res = await raw(method, path, body);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Fetches a protected file (an ID image or a Fiche PDF) as a Blob. Same session handling as `api`. The caller
 * turns it into an object URL and must revoke it when done: the decrypted bytes then live only in this tab.
 */
export async function apiBlob(path: string): Promise<Blob> {
  let res = await raw('GET', path);
  if (res.status === 401) {
    const err = await toError(res.clone());
    if (err.code === 'UNAUTHENTICATED' && (await refreshSession())) res = await raw('GET', path);
  }
  if (!res.ok) throw await toError(res);
  return res.blob();
}

/**
 * Only same-origin paths, to avoid open redirects through ?next=.
 * Browsers drop tabs/newlines while parsing URLs ("/\t/evil.com" becomes "//evil.com"), so the value is
 * resolved the way the browser would and its origin compared, and control characters or backslashes are refused.
 */
export function safeNext(next: string | null | undefined, fallback = '/', origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must be refused
  if (!next || !next.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}
