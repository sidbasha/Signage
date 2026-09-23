// Offline media storage that works in any context.
// Cache Storage needs a secure context (HTTPS or localhost). TVs and tablets on a LAN usually reach the
// server over plain http://192.168.x.x, where only IndexedDB is available, so both backends are supported.

export interface MediaStore {
  has(key: string): Promise<boolean>;
  put(key: string, data: ArrayBuffer, type: string): Promise<void>;
  get(key: string): Promise<Blob | undefined>;
  keys(): Promise<string[]>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

const CACHE = "signage-media-v1";
const DB = "signage-player", STORE = "media";

class CacheStorageStore implements MediaStore {
  private open = () => caches.open(CACHE);
  async has(k: string) { return !!(await (await this.open()).match(k)); }
  async put(k: string, d: ArrayBuffer, type: string) {
    await (await this.open()).put(k, new Response(d, { headers: { "Content-Type": type, "Content-Length": String(d.byteLength) } }));
  }
  async get(k: string) { const r = await (await this.open()).match(k); return r ? r.blob() : undefined; }
  async keys() { return (await (await this.open()).keys()).map(r => new URL(r.url).pathname); }
  async delete(k: string) { await (await this.open()).delete(k); }
  async clear() { await caches.delete(CACHE); }
}

class IndexedDbStore implements MediaStore {
  private db: Promise<IDBDatabase> | null = null;
  private conn() {
    this.db ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return this.db;
  }
  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.conn();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode); const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
  async has(k: string) { return (await this.run("readonly", s => s.count(k))) > 0; }
  async put(k: string, d: ArrayBuffer, type: string) { await this.run("readwrite", s => s.put(new Blob([d], { type }), k)); }
  async get(k: string) { return (await this.run<Blob | undefined>("readonly", s => s.get(k))) ?? undefined; }
  async keys() { return (await this.run("readonly", s => s.getAllKeys())).map(String); }
  async delete(k: string) { await this.run("readwrite", s => s.delete(k)); }
  async clear() { await this.run("readwrite", s => s.clear()); }
}

export const mediaStore: MediaStore = typeof caches !== "undefined" ? new CacheStorageStore() : new IndexedDbStore();
export const storeKind = typeof caches !== "undefined" ? "cache-storage" : "indexeddb";

// ---- SHA-256: WebCrypto when available, otherwise a pure-JS implementation (FIPS 180-4).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

export function sha256Js(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf), len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const tail = new Uint8Array(total - Math.floor(len / 64) * 64);
  tail.set(bytes.subarray(Math.floor(len / 64) * 64)); tail[len % 64] = 0x80;
  const tv = new DataView(tail.buffer);
  tv.setUint32(tail.length - 8, Math.floor(len / 0x20000000)); tv.setUint32(tail.length - 4, (len << 3) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const full = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blocks = Math.floor(len / 64);
  for (let b = 0; b < total / 64; b++) {
    const dv = b < blocks ? full : tv, off = b < blocks ? b * 64 : (b - blocks) * 64;
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += bb; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return [...h].map(x => x.toString(16).padStart(8, "0")).join("");
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const d = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  return sha256Js(buf);
}

/** Bridge injected by the Android app (see android/). Absent in a normal browser. */
export interface NativeBridge { deviceType(): string; model(): string; osVersion(): string; appVersion(): string; hardwareId(): string; reload(): void; openSettings(): void }
export const native: NativeBridge | undefined = (globalThis as unknown as { SignageNative?: NativeBridge }).SignageNative;
