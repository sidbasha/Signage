import type { AuthResponse } from "./types";

const STORAGE_KEY = "signage.session";
export const API_BASE = import.meta.env.VITE_API_URL ?? "";

interface Session { accessToken: string; refreshToken: string; accessTokenExpiresAt: string }

export class ApiError extends Error {
  constructor(public status: number, message: string, public fieldErrors: Record<string, string[]> = {}) { super(message); }
  /** First message for a field (server keys are camelCase; zone errors use e.g. "zones[0]"). */
  field(name: string) { return this.fieldErrors[name]?.[0]; }
}

let session: Session | null = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"); } catch { return null; } })();
const listeners = new Set<() => void>();
export const onSessionChange = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export function setSession(r: AuthResponse | null) {
  session = r ? { accessToken: r.accessToken, refreshToken: r.refreshToken, accessTokenExpiresAt: r.accessTokenExpiresAt } : null;
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); else localStorage.removeItem(STORAGE_KEY);
  listeners.forEach(l => l());
}
export const hasSession = () => session != null;

let refreshing: Promise<boolean> | null = null;
/** Single-flight refresh: concurrent 401s share one refresh call (refresh tokens rotate and are single-use). */
export function refreshSession(): Promise<boolean> {
  if (!session) return Promise.resolve(false);
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: session!.refreshToken }) });
      if (!res.ok) { setSession(null); return false; }
      setSession(await res.json());
      return true;
    } catch { return false; } finally { refreshing = null; }
  })();
  return refreshing;
}

/** Returns a valid access token, refreshing it shortly before expiry. Used by SignalR too. */
export async function getAccessToken(): Promise<string> {
  if (session && new Date(session.accessTokenExpiresAt).getTime() - Date.now() < 30_000) await refreshSession();
  return session?.accessToken ?? "";
}

async function toError(res: Response) {
  let body: { detail?: string; title?: string; errors?: Record<string, string[]> } = {};
  try { body = await res.json(); } catch { /* not json */ }
  const msg = body.detail ?? body.title ?? (res.status === 403 ? "You don't have permission to do that." : `Request failed (${res.status}).`);
  return new ApiError(res.status, msg, body.errors ?? {});
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  const token = await getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(init.json); }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
  if (res.status === 401 && retry && session && await refreshSession()) return api<T>(path, init, false);
  if (!res.ok) throw await toError(res);
  if (res.status === 204 || res.status === 202) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Multipart upload with progress (fetch has no upload progress in browsers). */
export function upload<T>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return getAccessToken().then(token => new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(JSON.parse(xhr.responseText));
      reject(await toError(new Response(xhr.responseText, { status: xhr.status })));
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed. Check your connection and try again."));
    xhr.send(form);
  }));
}

export const mediaUrl = (relative?: string) => (relative ? `${API_BASE}${relative}` : undefined);
