// Player engine: credentials, manifest sync, verified offline media cache, schedule evaluation, proof-of-play queue.
// No React here, so the same logic can be reused by other shells (e.g. an Android WebView wrapper).
import { mediaStore, native, sha256Hex } from "./store";

export interface ManifestMedia { id: string; name: string; type: "Image" | "Video" | "Web"; mimeType?: string; sha256?: string; sizeBytes: number; durationSeconds: number; url?: string; sourceUrl?: string }
export interface ManifestPlaylist { id: string; name: string; shuffle: boolean; items: { mediaId: string; durationSeconds: number; transition: string }[] }
export interface ManifestZone { id: string; name: string; x: number; y: number; width: number; height: number; zIndex: number; playlistId?: string | null }
export interface ManifestLayout { id: string; name: string; width: number; height: number; backgroundColor: string; zones: ManifestZone[] }
export interface ManifestSchedule { id: string; name: string; priority: number; layoutId?: string | null; playlistId?: string | null; startDate: string; endDate?: string | null; startTime?: string | null; endTime?: string | null; daysOfWeek: number }
export interface Manifest {
  version: string; generatedAt: string; device: { id: string; name: string; orientation: string; timeZone: string; organizationName: string };
  defaultPlaylistId?: string | null; schedules: ManifestSchedule[]; layouts: ManifestLayout[]; playlists: ManifestPlaylist[]; media: ManifestMedia[];
}
export type Program = { kind: "layout"; layout: ManifestLayout; scheduleId: string } | { kind: "playlist"; playlist: ManifestPlaylist; scheduleId?: string } | { kind: "idle" };

export const API_BASE = import.meta.env.VITE_API_URL ?? "";
const K = { creds: "signage.player.creds", manifest: "signage.player.manifest", plays: "signage.player.plays" };

// ------------------------------------------------------------------ credentials
export interface Credentials { deviceKey: string; deviceId: string }
export const loadCreds = (): Credentials | null => { try { return JSON.parse(localStorage.getItem(K.creds) ?? "null"); } catch { return null; } };
export const saveCreds = (c: Credentials) => localStorage.setItem(K.creds, JSON.stringify(c));
export async function forgetDevice() {
  localStorage.removeItem(K.creds); localStorage.removeItem(K.manifest); localStorage.removeItem(K.plays);
  await mediaStore.clear().catch(() => {});
}

export function detectDeviceType() {
  if (native) return native.deviceType();
  const ua = navigator.userAgent;
  if (/Android/i.test(ua) && /(TV|AFT|BRAVIA|SMART-TV|GoogleTV)/i.test(ua)) return "AndroidTv";
  if (/Android/i.test(ua)) return "AndroidTablet";
  return "WebPlayer";
}
export const resolution = () => `${Math.round(screen.width * devicePixelRatio)}x${Math.round(screen.height * devicePixelRatio)}`;
export const APP_VERSION = native ? `android-${native.appVersion()}` : "web-1.1.0";

// ------------------------------------------------------------------ HTTP
export class RevokedError extends Error {}
async function deviceFetch(path: string, key: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers); headers.set("Authorization", `Device ${key}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: "no-store" });
  if (res.status === 401) throw new RevokedError("Device key revoked");
  return res;
}

// ------------------------------------------------------------------ manifest + media sync
export const loadCachedManifest = (): Manifest | null => { try { return JSON.parse(localStorage.getItem(K.manifest) ?? "null"); } catch { return null; } };

const cacheKey = (m: ManifestMedia) => `/__signage-media/${m.id}/${m.sha256 ?? "x"}`;

/**
 * Fetches the manifest. If it changed, downloads every missing media file, verifies its sha256,
 * and only then swaps the new manifest in, so a half-finished sync never breaks playback.
 */
export async function sync(key: string, onProgress?: (done: number, total: number) => void): Promise<{ manifest: Manifest; changed: boolean }> {
  const current = loadCachedManifest();
  const headers: HeadersInit = current ? { "If-None-Match": `"${current.version}"` } : {};
  const res = await deviceFetch("/api/player/manifest", key, { headers });
  if (res.status === 304 && current) {
    // Content unchanged, but make sure every file is still on disk (the cache can be evicted).
    await ensureMedia(current, onProgress);
    return { manifest: current, changed: false };
  }
  if (!res.ok) throw new Error(`Manifest request failed (${res.status})`);
  const next: Manifest = await res.json();
  await ensureMedia(next, onProgress);
  localStorage.setItem(K.manifest, JSON.stringify(next));
  await pruneMedia(next);
  return { manifest: next, changed: current?.version !== next.version };
}

async function ensureMedia(m: Manifest, onProgress?: (done: number, total: number) => void) {
  const files = m.media.filter(x => x.type !== "Web" && x.url);
  let done = 0;
  for (const f of files) {
    if (!(await mediaStore.has(cacheKey(f)))) {
      const res = await fetch(`${API_BASE}${f.url}`);
      if (!res.ok) throw new Error(`Download failed for ${f.id} (${res.status})`);
      const buf = await res.arrayBuffer();
      const hash = await sha256Hex(buf);
      if (f.sha256 && hash !== f.sha256) throw new Error(`Checksum mismatch for ${f.id}`);
      await mediaStore.put(cacheKey(f), buf, f.mimeType ?? "application/octet-stream");
    }
    onProgress?.(++done, files.length);
  }
}

async function pruneMedia(m: Manifest) {
  const keep = new Set(m.media.map(cacheKey));
  for (const k of await mediaStore.keys()) if (!keep.has(k)) await mediaStore.delete(k);
}

const objectUrls = new Map<string, string>();
/** Object URL for a cached media file (works fully offline). Falls back to the network URL. */
export async function mediaSrc(m: ManifestMedia): Promise<string | undefined> {
  if (m.type === "Web") return m.sourceUrl;
  const k = cacheKey(m);
  const hit = objectUrls.get(k); if (hit) return hit;
  const blob = await mediaStore.get(k);
  if (!blob) return m.url ? `${API_BASE}${m.url}` : undefined;
  const url = URL.createObjectURL(blob);
  objectUrls.set(k, url);
  return url;
}
export function releaseUnused(m: Manifest) {
  const keep = new Set(m.media.map(cacheKey));
  for (const [k, u] of objectUrls) if (!keep.has(k)) { URL.revokeObjectURL(u); objectUrls.delete(k); }
}
export async function clearMediaCache() { await mediaStore.clear(); objectUrls.forEach(u => URL.revokeObjectURL(u)); objectUrls.clear(); localStorage.removeItem(K.manifest); }

export async function storageFree(): Promise<number | undefined> {
  try { const e = await navigator.storage?.estimate(); return e?.quota != null && e.usage != null ? e.quota - e.usage : undefined; } catch { return undefined; }
}

// ------------------------------------------------------------------ scheduling (runs on-device, in the screen's time zone)
export function localNow(timeZone: string, at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
    .formatToParts(at).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date, weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const prevDate = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const inRange = (s: ManifestSchedule, date: string) => date >= s.startDate && (!s.endDate || date <= s.endDate);
const onDay = (s: ManifestSchedule, weekday: number) => (s.daysOfWeek & (1 << weekday)) !== 0;

export function isScheduleActive(s: ManifestSchedule, now: { date: string; weekday: number; minutes: number }) {
  if (!s.startTime || !s.endTime) return inRange(s, now.date) && onDay(s, now.weekday);
  const start = toMin(s.startTime), end = toMin(s.endTime);
  if (start < end) return inRange(s, now.date) && onDay(s, now.weekday) && now.minutes >= start && now.minutes < end;
  // Overnight window (e.g. 22:00–02:00): the part after midnight belongs to the previous day's occurrence.
  if (now.minutes >= start) return inRange(s, now.date) && onDay(s, now.weekday);
  if (now.minutes < end) return inRange(s, prevDate(now.date)) && onDay(s, (now.weekday + 6) % 7);
  return false;
}

export function pickProgram(m: Manifest, at = new Date()): Program {
  const now = localNow(m.device.timeZone, at);
  for (const s of m.schedules) { // server sends them sorted by priority (desc)
    if (!isScheduleActive(s, now)) continue;
    if (s.layoutId) { const layout = m.layouts.find(l => l.id === s.layoutId); if (layout) return { kind: "layout", layout, scheduleId: s.id }; }
    if (s.playlistId) { const playlist = m.playlists.find(p => p.id === s.playlistId); if (playlist?.items.length) return { kind: "playlist", playlist, scheduleId: s.id }; }
  }
  const def = m.playlists.find(p => p.id === m.defaultPlaylistId);
  return def?.items.length ? { kind: "playlist", playlist: def } : { kind: "idle" };
}

// ------------------------------------------------------------------ proof of play
interface Play { mediaId: string; playlistId?: string; playedAt: string; durationSeconds: number }
export function recordPlay(p: Play) {
  let q: Play[] = [];
  try { q = JSON.parse(localStorage.getItem(K.plays) ?? "[]"); } catch { /* reset */ }
  q.push(p);
  localStorage.setItem(K.plays, JSON.stringify(q.slice(-5000))); // bounded while offline
}
export async function flushPlays(key: string) {
  let q: Play[] = [];
  try { q = JSON.parse(localStorage.getItem(K.plays) ?? "[]"); } catch { return; }
  if (!q.length) return;
  const batch = q.slice(0, 1000);
  const res = await deviceFetch("/api/player/playback", key, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch) });
  if (res.ok) {
    const rest: Play[] = JSON.parse(localStorage.getItem(K.plays) ?? "[]").slice(batch.length);
    localStorage.setItem(K.plays, JSON.stringify(rest));
  }
}

export async function heartbeatRest(key: string, body: object) {
  await deviceFetch("/api/player/heartbeat", key, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
