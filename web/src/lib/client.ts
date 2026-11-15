'use client';

export class Problem extends Error {
  constructor(message: string, public status: number, public fieldErrors: Record<string, string> = {}, public code?: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Calls the app's own /api routes (same origin, cookie attached by the browser). Throws Problem with the API's words. */
export async function send<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new Problem('No connection to the server. Check the network and try again.', 0);
  }
  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/session') && !path.startsWith('/api/kiosk-session')) {
      // the session ended (signed out elsewhere, deactivated, expired)
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/kiosk')) window.location.href = '/?ended=1';
    }
    throw new Problem(String(data.message ?? 'Something went wrong'), res.status, (data.fieldErrors as Record<string, string>) ?? {}, data.code as string | undefined, data);
  }
  return data as T;
}
