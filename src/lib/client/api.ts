export class ApiError extends Error {
  readonly status: number;
  readonly issues: { path: string; message: string }[];
  constructor(message: string, status: number, issues: { path: string; message: string }[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

/** The session ended: go and sign in. For direct fetch callers too. */
export function goToLogin() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full reload is the point: shared state starts over for the new session
  window.location.assign("/login");
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  }).catch(() => {
    throw new ApiError("Couldn't reach the Jarvis server. Check that it's running, then try again.", 0);
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/auth/")) {
    goToLogin();
    return new Promise<T>(() => {}); // The page is leaving; nothing should react to this request.
  }
  if (!res.ok) throw new ApiError(data.error ?? data.message ?? `Request failed (${res.status})`, res.status, data.issues);
  return data as T;
}

/** Field-path → message map for showing validation errors next to inputs. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  return Object.fromEntries(err.issues.map((i) => [i.path, i.message]));
}
