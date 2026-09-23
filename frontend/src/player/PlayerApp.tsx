import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as signalR from "@microsoft/signalr";
import { native } from "./store";
import {
  API_BASE, APP_VERSION, RevokedError, clearMediaCache, detectDeviceType, flushPlays, forgetDevice, heartbeatRest, loadCachedManifest, loadCreds,
  mediaSrc, pickProgram, recordPlay, releaseUnused, resolution, saveCreds, storageFree, sync,
  type Credentials, type Manifest, type ManifestMedia, type ManifestPlaylist, type Program,
} from "./engine";

export default function PlayerApp() {
  const [creds, setCreds] = useState<Credentials | null>(loadCreds);
  useEffect(() => {
    document.title = "Signage Player";
    // Service workers need HTTPS or localhost. Inside the Android app, the WebView's HTTP cache serves the shell offline instead.
    if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/player-sw.js").catch(() => {});
  }, []);
  if (!creds) return <Pairing onPaired={c => { saveCreds(c); setCreds(c); }} />;
  return <Playing creds={creds} onRevoked={async () => { await forgetDevice(); setCreds(null); }} />;
}

// ------------------------------------------------------------------ pairing
function Pairing({ onPaired }: { onPaired: (c: Credentials) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => {
    let cancelled = false; let timer: number;
    const start = async () => {
      try {
        setError(null);
        const res = await fetch(`${API_BASE}/api/pairing`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceType: detectDeviceType(), hardwareId: hardwareId(), resolution: resolution(), appVersion: APP_VERSION, osVersion: osVersion() }) });
        if (!res.ok) throw new Error(res.status === 429 ? "Too many attempts. Retrying shortly." : `Server error (${res.status})`);
        const p: { pairingId: string; code: string; pollSecret: string; expiresAt: string; pollIntervalSeconds: number } = await res.json();
        if (cancelled) return;
        setCode(p.code); setExpiresAt(new Date(p.expiresAt).getTime());
        const poll = async () => {
          if (cancelled) return;
          try {
            const s = await fetch(`${API_BASE}/api/pairing/${p.pairingId}`, { headers: { "X-Poll-Secret": p.pollSecret }, cache: "no-store" });
            const st: { status: string; deviceId?: string; deviceKey?: string } = s.ok ? await s.json() : { status: "Expired" };
            if (st.status === "Paired" && st.deviceKey && st.deviceId) return onPaired({ deviceKey: st.deviceKey, deviceId: st.deviceId });
            if (st.status === "Expired" || st.status === "Paired") return start(); // expired, or key already collected elsewhere: get a new code
          } catch { /* offline: keep polling */ }
          timer = window.setTimeout(poll, p.pollIntervalSeconds * 1000);
        };
        poll();
      } catch (e) {
        if (!cancelled) { setError((e as Error).message || "Can't reach the server."); timer = window.setTimeout(start, 5000); }
      }
    };
    start();
    const t = window.setInterval(() => tick(x => x + 1), 1000);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(t); };
  }, [onPaired]);

  const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  return (
    <div className="flex h-screen w-screen cursor-none flex-col items-center justify-center gap-8 bg-ink p-8 text-center text-white">
      <p className="text-[2.2vmin] uppercase tracking-[0.3em] text-white/50">Pair this screen</p>
      <div className="font-mono text-[14vmin] font-semibold leading-none tracking-[0.18em] text-white" aria-live="polite">
        {code ? `${code.slice(0, 3)} ${code.slice(3)}` : "· · ·"}
      </div>
      <p className="max-w-[70vmin] text-[2.6vmin] leading-relaxed text-white/70">
        In the Signage CMS, open <span className="text-white">Devices → Pair a screen</span> and enter this code.
      </p>
      <p className="text-[1.8vmin] text-white/40">{error ?? (code ? `Code refreshes in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Connecting…")}</p>
      <div className="absolute bottom-6 font-mono text-[1.4vmin] text-white/25">{window.location.host} · {detectDeviceType()} · {resolution()}</div>
    </div>
  );
}

function hardwareId() {
  if (native) return native.hardwareId();
  let id = localStorage.getItem("signage.player.hwid");
  if (!id) { id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; localStorage.setItem("signage.player.hwid", id); }
  return id;
}

const osVersion = () => (native ? `${native.model()} · Android ${native.osVersion()}` : navigator.userAgent.slice(0, 200));

// ------------------------------------------------------------------ playing
function Playing({ creds, onRevoked }: { creds: Credentials; onRevoked: () => void }) {
  const [manifest, setManifest] = useState<Manifest | null>(loadCachedManifest);
  const [program, setProgram] = useState<Program>({ kind: "idle" });
  const [progress, setProgress] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [identify, setIdentify] = useState(false);
  const current = useRef<string | undefined>();
  const hub = useRef<signalR.HubConnection | null>(null);
  const syncing = useRef(false);
  const pending = useRef(false);
  const revoked = useRef(onRevoked); revoked.current = onRevoked;

  const doSync = useCallback(async () => {
    if (syncing.current) { pending.current = true; return; }
    syncing.current = true;
    try {
      const { manifest: m, changed } = await sync(creds.deviceKey, (d, t) => setProgress(t ? `Downloading content ${d}/${t}` : null));
      if (changed || !manifest) { setManifest(m); releaseUnused(m); }
      setLastError(null);
    } catch (e) {
      if (e instanceof RevokedError) return revoked.current();
      setLastError((e as Error).message); // offline or server error: keep playing cached content
    } finally {
      setProgress(null); syncing.current = false;
      if (pending.current) { pending.current = false; doSync(); }
    }
  }, [creds.deviceKey, manifest]);
  const syncRef = useRef(doSync); syncRef.current = doSync;

  // periodic sync (push is the fast path; this is the safety net)
  useEffect(() => { syncRef.current(); const t = setInterval(() => syncRef.current(), 5 * 60_000); return () => clearInterval(t); }, []);

  // real-time channel: presence, content pushes, commands
  useEffect(() => {
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(`${API_BASE}/hubs/device`, { accessTokenFactory: () => creds.deviceKey })
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: ctx => Math.min(30_000, 1000 * 2 ** Math.min(ctx.previousRetryCount, 5)) })
      .configureLogging(signalR.LogLevel.None).build();
    hub.current = conn;
    conn.on("ContentChanged", () => syncRef.current());
    conn.on("Revoked", () => revoked.current());
    conn.on("Command", async ({ command }: { command: string }) => {
      if (command === "refresh") syncRef.current();
      if (command === "reload") { if (native) native.reload(); else window.location.reload(); }
      if (command === "identify") { setIdentify(true); setTimeout(() => setIdentify(false), 10_000); }
      if (command === "clear-cache") { await clearMediaCache(); setManifest(null); syncRef.current(); }
    });
    conn.onreconnecting(() => setConnected(false));
    conn.onreconnected(() => { setConnected(true); syncRef.current(); });
    let stopped = false;
    const start = async () => {
      try { await conn.start(); if (!stopped) setConnected(true); }
      catch { if (!stopped) { setConnected(false); setTimeout(start, 10_000); } }
    };
    conn.onclose(() => { setConnected(false); if (!stopped) setTimeout(start, 5000); });
    start();
    return () => { stopped = true; conn.stop(); };
  }, [creds.deviceKey]);

  // heartbeat + proof-of-play upload
  useEffect(() => {
    const beat = async () => {
      const body = { appVersion: APP_VERSION, osVersion: osVersion(), resolution: resolution(), syncedVersion: loadCachedManifest()?.version,
        currentItem: current.current, freeStorageBytes: await storageFree() };
      try {
        if (hub.current?.state === signalR.HubConnectionState.Connected) await hub.current.invoke("Heartbeat", body);
        else await heartbeatRest(creds.deviceKey, body);
      } catch (e) { if (e instanceof RevokedError) revoked.current(); }
      flushPlays(creds.deviceKey).catch(() => {});
    };
    const first = setTimeout(beat, 3000);
    const t = setInterval(beat, 30_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [creds.deviceKey]);

  // re-evaluate schedules locally every 15 s (works with no network at all)
  useEffect(() => {
    if (!manifest) return;
    const evaluate = () => setProgram(prev => {
      const next = pickProgram(manifest);
      const id = (p: Program) => `${p.kind}:${p.kind === "layout" ? p.layout.id : p.kind === "playlist" ? p.playlist.id : ""}:${manifest.version}`;
      return id(prev) === id(next) ? prev : next;
    });
    evaluate();
    const t = setInterval(evaluate, 15_000);
    return () => clearInterval(t);
  }, [manifest]);

  // keep the screen awake, hide the cursor
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const acquire = () => (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen").then(l => (lock = l)).catch(() => {});
    acquire();
    const onVis = () => document.visibilityState === "visible" && acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); lock?.release().catch(() => {}); };
  }, []);

  const mediaById = useMemo(() => new Map((manifest?.media ?? []).map(m => [m.id, m])), [manifest]);
  const onPlay = useCallback((name: string) => { current.current = name; }, []);
  const portrait = manifest?.device.orientation === "Portrait";

  return (
    <div className="relative h-screen w-screen cursor-none overflow-hidden bg-black text-white" onDoubleClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>
      {!manifest ? <Splash text={progress ?? lastError ?? "Preparing content…"} /> :
        program.kind === "idle" ? <Idle manifest={manifest} /> :
        program.kind === "playlist" ? <ZonePlayer key={`${program.playlist.id}:${manifest.version}`} playlist={program.playlist} media={mediaById} onPlay={onPlay} /> :
        <div className="absolute inset-0" style={{ background: program.layout.backgroundColor }}>
          {program.layout.zones.map(z => {
            const pl = manifest.playlists.find(p => p.id === z.playlistId);
            return (
              <div key={z.id} className="absolute overflow-hidden" style={{ left: `${z.x}%`, top: `${z.y}%`, width: `${z.width}%`, height: `${z.height}%`, zIndex: z.zIndex }}>
                {pl?.items.length ? <ZonePlayer key={`${pl.id}:${manifest.version}`} playlist={pl} media={mediaById} onPlay={z.zIndex === 0 ? onPlay : undefined} /> : null}
              </div>);
          })}
        </div>}
      {identify && manifest && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[hsl(184_85%_28%/.92)]">
          <div className="text-[9vmin] font-semibold">{manifest.device.name}</div>
          <div className="text-[2.5vmin] opacity-80">{manifest.device.organizationName} · {portrait ? "Portrait" : "Landscape"} · v{manifest.version.slice(0, 7)}</div>
        </div>
      )}
      {progress && manifest && <div className="absolute bottom-3 right-3 z-40 rounded bg-black/60 px-2 py-1 text-xs text-white/80">{progress}</div>}
      {!connected && manifest && <div className="absolute bottom-3 left-3 z-40 h-2 w-2 rounded-full bg-[hsl(37_72%_50%)] opacity-70" title="Offline: playing cached content" />}
    </div>
  );
}

function Splash({ text }: { text: string }) {
  return <div className="flex h-full flex-col items-center justify-center gap-4 bg-ink"><div className="h-1 w-40 overflow-hidden rounded bg-white/10"><div className="h-full w-1/3 animate-pulse bg-[hsl(184_85%_40%)]" /></div><p className="text-[2vmin] text-white/60">{text}</p></div>;
}

function Idle({ manifest }: { manifest: Manifest }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 10_000); return () => clearInterval(t); }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-ink">
      <div className="text-[12vmin] font-light tabular-nums">{now.toLocaleTimeString([], { timeZone: manifest.device.timeZone, hour: "2-digit", minute: "2-digit" })}</div>
      <div className="text-[2.4vmin] text-white/60">{manifest.device.name} · nothing scheduled right now</div>
    </div>
  );
}

/** Plays a playlist in a loop. Images and web pages show for their duration; videos play to the end. */
function ZonePlayer({ playlist, media, onPlay }: { playlist: ManifestPlaylist; media: Map<string, ManifestMedia>; onPlay?: (name: string) => void }) {
  const items = useMemo(() => {
    const valid = playlist.items.filter(i => media.has(i.mediaId));
    if (!playlist.shuffle) return valid;
    const a = [...valid]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
  }, [playlist, media]);
  const [n, setN] = useState(0);
  const [src, setSrc] = useState<string>();
  const item = items.length ? items[n % items.length] : undefined;
  const m = item ? media.get(item.mediaId) : undefined;
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (!m) return;
    let alive = true; setSrc(undefined);
    mediaSrc(m).then(s => alive && setSrc(s));
    startedAt.current = Date.now(); onPlay?.(m.name);
    return () => { alive = false; };
  }, [m, n, onPlay]);

  const next = useCallback(() => {
    if (item && m) recordPlay({ mediaId: m.id, playlistId: playlist.id, playedAt: new Date(startedAt.current).toISOString(), durationSeconds: Math.round((Date.now() - startedAt.current) / 1000) });
    setN(x => x + 1);
  }, [item, m, playlist.id]);

  useEffect(() => {
    if (!item || !m || !src) return;
    // Videos advance on "ended"; the timer is a safety net for stalled or undecodable video.
    const ms = m.type === "Video" ? Math.max(item.durationSeconds, m.durationSeconds, 5) * 1000 + 5000 : Math.max(1, item.durationSeconds) * 1000;
    const t = setTimeout(next, ms);
    return () => clearTimeout(t);
  }, [item, m, src, next]);

  if (!item || !m) return null;
  const anim = item.transition === "slide" ? "animate-in slide-in-from-right duration-700" : item.transition === "fade" ? "animate-in fade-in duration-700" : "";
  return (
    <div key={n} className={`absolute inset-0 ${anim}`}>
      {!src ? null
        : m.type === "Image" ? <img src={src} alt="" className="h-full w-full object-contain" onError={next} />
        : m.type === "Video" ? <video src={src} className="h-full w-full object-contain" autoPlay muted playsInline onEnded={next} onError={next} />
        : <iframe src={src} title={m.name} className="h-full w-full border-0 bg-white" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />}
    </div>
  );
}
