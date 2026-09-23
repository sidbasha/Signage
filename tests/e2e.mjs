// End-to-end test against a running API (default http://localhost:5080). Uses real HTTP, real DB, real SignalR.
import * as signalR from "@microsoft/signalr";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const BASE = process.env.API_URL ?? "http://localhost:5080";
let passed = 0, failed = 0;
const ok = (cond, name, extra = "") => { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${extra}`); } };
const section = (s) => console.log(`\n${s}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const uniq = Date.now().toString(36);

async function api(method, path, { token, device, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (device) h.Authorization = `Device ${device}`;
  let payload;
  if (form) payload = form; else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, headers: res.headers, text };
}

function png(w, h, rgb) { // minimal valid PNG generator
  const crc = (buf) => { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function uploadImage(token, name, color) {
  const fd = new FormData();
  fd.append("file", new Blob([png(64, 36, color)], { type: "image/png" }), `${name}.png`);
  fd.append("width", "64"); fd.append("height", "36"); fd.append("durationSeconds", "8");
  return api("POST", "/api/media", { token, form: fd });
}

async function pairDevice(token, name, extra = {}) {
  const req = await api("POST", "/api/pairing", { body: { deviceType: "WebPlayer", hardwareId: `hw-${name}`, resolution: "1920x1080", appVersion: "1.0.0" } });
  const paired = await api("POST", "/api/devices/pair", { token, body: { code: req.json.code, name, ...extra } });
  const st = await api("GET", `/api/pairing/${req.json.pairingId}`, { headers: { "X-Poll-Secret": req.json.pollSecret } });
  return { req, paired, st };
}

function deviceHub(key) {
  const events = [];
  const conn = new signalR.HubConnectionBuilder().withUrl(`${BASE}/hubs/device`, { accessTokenFactory: () => key }).configureLogging(signalR.LogLevel.None).build();
  for (const ev of ["ContentChanged", "Command", "Revoked"]) conn.on(ev, (p) => events.push({ ev, p }));
  return { conn, events };
}
const waitFor = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };

// ------------------------------------------------------------------------------------------
section("Authentication");
let r = await api("POST", "/api/auth/login", { body: { email: "admin@demo.local", password: "wrong-password1" } });
ok(r.status === 401, "rejects wrong password", r.status);
r = await api("POST", "/api/auth/login", { body: { email: "admin@demo.local", password: "Admin@12345" } });
ok(r.status === 200 && r.json.accessToken, "demo owner signs in");
let A = r.json.accessToken; const refreshA = r.json.refreshToken;
ok(r.json.user.permissions.includes("subscription.manage"), "owner token carries all permissions");
r = await api("GET", "/api/auth/me", { token: A });
ok(r.status === 200 && r.json.organizationName === "Demo Signage Co", "GET /auth/me");
ok((await api("GET", "/api/devices")).status === 401, "protected endpoint requires a token");

r = await api("POST", "/api/auth/refresh", { body: { refreshToken: refreshA } });
ok(r.status === 200 && r.json.refreshToken !== refreshA, "refresh rotates the refresh token");
const rotated = r.json.refreshToken; A = r.json.accessToken;
r = await api("POST", "/api/auth/refresh", { body: { refreshToken: refreshA } });
ok(r.status === 401, "reusing a rotated refresh token is rejected");
r = await api("POST", "/api/auth/refresh", { body: { refreshToken: rotated } });
ok(r.status === 401, "token reuse revokes the whole session family");
A = (await api("POST", "/api/auth/login", { body: { email: "admin@demo.local", password: "Admin@12345" } })).json.accessToken;

r = await api("POST", "/api/auth/register", { body: { organizationName: "", fullName: "x", email: "bad", password: "short" } });
ok(r.status === 400 && r.json.errors?.password && r.json.errors?.email, "registration validates fields (400 + field errors)");
r = await api("POST", "/api/auth/register", { body: { organizationName: `Rival Displays ${uniq}`, fullName: "Rita Rival", email: `rita-${uniq}@rival.test`, password: "Rival12345", timeZone: "Europe/London" } });
ok(r.status === 200, "second organization registers");
const B = r.json.accessToken;

// ------------------------------------------------------------------------------------------
section("Organization structure");
r = await api("POST", "/api/locations", { token: A, body: { name: `Lobby ${uniq}`, city: "Chennai", country: "India", timeZone: "Asia/Kolkata" } });
ok(r.status === 200, "create location"); const loc = r.json;
r = await api("POST", "/api/locations", { token: A, body: { name: "Bad tz", timeZone: "Mars/Olympus" } });
ok(r.status === 400, "invalid time zone rejected");
r = await api("POST", "/api/device-groups", { token: A, body: { name: `Reception screens ${uniq}` } });
ok(r.status === 200, "create device group"); const group = r.json;

// ------------------------------------------------------------------------------------------
section("Media library");
r = await uploadImage(A, `welcome-${uniq}`, [11, 122, 131]);
ok(r.status === 200 && r.json.sha256?.length === 64, "upload PNG (sha256 computed server-side)"); const img1 = r.json;
r = await uploadImage(A, `menu-${uniq}`, [232, 163, 61]); const img2 = r.json;
const bad = new FormData(); bad.append("file", new Blob(["MZ..."]), "virus.exe");
r = await api("POST", "/api/media", { token: A, form: bad });
ok(r.status === 400, "rejects unsupported file types");
r = await api("POST", "/api/media/web", { token: A, body: { name: "Status page", url: "https://example.com", durationSeconds: 15 } });
ok(r.status === 200 && r.json.type === "Web", "add web page media"); const web = r.json;
r = await fetch(BASE + img1.contentUrl); const body1 = Buffer.from(await r.arrayBuffer());
ok(r.status === 200 && createHash("sha256").update(body1).digest("hex") === img1.sha256, "signed URL serves the exact bytes");
r = await fetch(BASE + img1.contentUrl, { headers: { Range: "bytes=0-9" } });
ok(r.status === 206, "range requests supported (206)");
r = await fetch(BASE + img1.contentUrl.replace(/sig=.{4}/, "sig=0000"));
ok(r.status === 403, "tampered signature rejected (403)");

// ------------------------------------------------------------------------------------------
section("Playlists, layouts, templates");
r = await api("POST", "/api/playlists", { token: A, body: { name: `Welcome loop ${uniq}`, shuffle: false, items: [
  { mediaAssetId: img1.id, durationSeconds: 5, transition: "fade" }, { mediaAssetId: img2.id, transition: "slide" }, { mediaAssetId: web.id } ] } });
ok(r.status === 200 && r.json.itemCount === 3 && r.json.totalDurationSeconds === 5 + 8 + 15, "create playlist with 3 items and correct runtime");
const pl = r.json;
r = await api("DELETE", `/api/media/${img1.id}`, { token: A });
ok(r.status === 409, "can't delete media that a playlist uses (409)");
r = await api("GET", "/api/layouts/templates", { token: A });
ok(r.status === 200 && r.json.length >= 5, `templates seeded (${r.json.length})`);
const tpl = r.json.find(t => t.name === "Main with ticker");
r = await api("PUT", `/api/layouts/${tpl.id}`, { token: A, body: { name: "x", orientation: "Landscape", width: 1920, height: 1080, zones: [{ name: "a", x: 0, y: 0, width: 100, height: 100, zIndex: 0 }] } });
ok(r.status === 403, "templates are read-only");
r = await api("POST", `/api/layouts/from-template/${tpl.id}`, { token: A, body: { name: `Lobby layout ${uniq}` } });
ok(r.status === 200 && r.json.zones.length === 2, "create layout from template"); let layout = r.json;
r = await api("PUT", `/api/layouts/${layout.id}`, { token: A, body: { ...layout, zones: layout.zones.map(z => ({ ...z, playlistId: pl.id })) } });
ok(r.status === 200 && r.json.zones.every(z => z.playlistId === pl.id), "assign playlist to layout zones"); layout = r.json;
r = await api("PUT", `/api/layouts/${layout.id}`, { token: A, body: { ...layout, zones: [{ name: "Off-screen", x: 50, y: 0, width: 80, height: 100, zIndex: 0 }] } });
ok(r.status === 400, "zones must fit inside the screen");

// ------------------------------------------------------------------------------------------
section("Device pairing");
r = await api("POST", "/api/pairing", { body: { deviceType: "AndroidTv", hardwareId: `tv-${uniq}`, resolution: "3840x2160", appVersion: "1.0.0", osVersion: "Android 12" } });
ok(r.status === 200 && /^[A-Z2-9]{6}$/.test(r.json.code), `player gets pairing code ${r.json.code}`); const pr = r.json;
r = await api("GET", `/api/pairing/${pr.pairingId}`, { headers: { "X-Poll-Secret": pr.pollSecret } });
ok(r.json.status === "Pending" && !r.json.deviceKey, "status is Pending before claim");
r = await api("GET", `/api/pairing/${pr.pairingId}`, { headers: { "X-Poll-Secret": "wrong" } });
ok(r.status === 404, "wrong poll secret gets nothing");
r = await api("POST", "/api/devices/pair", { token: A, body: { code: "ZZZZZZ", name: "nope" } });
ok(r.status === 400, "unknown code rejected");
r = await api("POST", "/api/devices/pair", { token: A, body: { code: pr.code.toLowerCase(), name: `Lobby TV ${uniq}`, locationId: loc.id, groupIds: [group.id], defaultPlaylistId: pl.id } });
ok(r.status === 200 && r.json.type === "AndroidTv" && r.json.groups.length === 1, "admin claims code → device created in org"); const dev = r.json;
r = await api("GET", `/api/pairing/${pr.pairingId}`, { headers: { "X-Poll-Secret": pr.pollSecret } });
ok(r.json.status === "Paired" && r.json.deviceKey, "player collects its device key"); const KEY = r.json.deviceKey;
r = await api("GET", `/api/pairing/${pr.pairingId}`, { headers: { "X-Poll-Secret": pr.pollSecret } });
ok(r.json.status === "Paired" && !r.json.deviceKey, "device key is handed out only once");
r = await api("POST", "/api/devices/pair", { token: A, body: { code: pr.code, name: "again" } });
ok(r.status === 400, "a code can't be claimed twice");

// ------------------------------------------------------------------------------------------
section("Sync and offline manifest");
ok((await api("GET", "/api/player/manifest", { device: "not-a-key" })).status === 401, "bad device key rejected");
ok((await api("GET", "/api/player/manifest", { token: A })).status === 401, "admin JWT can't use player API");
r = await api("GET", "/api/player/manifest", { device: KEY });
ok(r.status === 200 && r.json.defaultPlaylistId === pl.id && r.json.media.length === 3, "manifest has default playlist and its 3 media");
ok(r.json.device.timeZone === "Asia/Kolkata", "manifest carries the location time zone for offline scheduling");
const etag = r.headers.get("etag"); const v1 = r.json.version;
const m1 = r.json.media.find(m => m.id === img1.id);
const dl = Buffer.from(await (await fetch(BASE + m1.url)).arrayBuffer());
ok(createHash("sha256").update(dl).digest("hex") === m1.sha256, "player can download and verify media by sha256");
r = await api("GET", "/api/player/manifest", { device: KEY, headers: { "If-None-Match": etag } });
ok(r.status === 304, "unchanged manifest returns 304 Not Modified");

// ------------------------------------------------------------------------------------------
section("Real-time: presence, content push, commands");
const adminEvents = [];
const admin = new signalR.HubConnectionBuilder().withUrl(`${BASE}/hubs/admin`, { accessTokenFactory: () => A }).configureLogging(signalR.LogLevel.None).build();
admin.on("DeviceStatus", p => adminEvents.push(["status", p])); admin.on("Notification", p => adminEvents.push(["notification", p]));
await admin.start(); ok(admin.state === "Connected", "admin hub connects with JWT");
const hub = deviceHub(KEY); await hub.conn.start();
ok(hub.conn.state === "Connected", "device hub connects with device key");
ok(await waitFor(() => adminEvents.some(([t, p]) => t === "status" && p.id === dev.id && p.status === "Online")), "admin UI is told the device is Online");
r = await api("GET", `/api/devices/${dev.id}`, { token: A });
ok(r.json.status === "Online" && r.json.lastSeenAt, "device status persisted as Online");
await hub.conn.invoke("Heartbeat", { appVersion: "1.0.1", syncedVersion: v1, currentItem: "welcome.png", freeStorageBytes: 5e9 });
r = await api("GET", `/api/devices/${dev.id}`, { token: A });
ok(r.json.appVersion === "1.0.1" && r.json.syncedVersion === v1 && r.json.currentItem === "welcome.png", "heartbeat over SignalR updates device state");

const today = new Date().toISOString().slice(0, 10);
r = await api("POST", "/api/schedules", { token: A, body: { name: `Morning lobby ${uniq}`, layoutId: layout.id, priority: 10, startDate: today, startTime: "08:00:00", endTime: "12:00:00", daysOfWeek: 62, isActive: true, deviceGroupIds: [group.id] } });
ok(r.status === 200 && r.json.targets.length === 1, "create schedule targeting the device group"); const sched = r.json;
ok(await waitFor(() => hub.events.some(e => e.ev === "ContentChanged")), "device receives ContentChanged push");
r = await api("GET", "/api/player/manifest", { device: KEY, headers: { "If-None-Match": etag } });
ok(r.status === 200 && r.json.version !== v1, "manifest version changes after scheduling");
ok(r.json.schedules[0]?.layoutId === layout.id && r.json.schedules[0].startTime === "08:00" && r.json.layouts[0]?.zones.length === 2, "manifest includes schedule window and layout zones");
r = await api("POST", "/api/schedules", { token: A, body: { name: "bad", layoutId: layout.id, playlistId: pl.id, priority: 1, startDate: today, daysOfWeek: 0, isActive: true } });
ok(r.status === 400 && r.json.errors?.content && r.json.errors?.daysOfWeek && r.json.errors?.targets, "schedule validation (content xor, days, targets)");

r = await api("POST", `/api/devices/${dev.id}/commands`, { token: A, body: { command: "identify" } });
ok(r.status === 202 && await waitFor(() => hub.events.some(e => e.ev === "Command" && e.p.command === "identify")), "command delivered to the device");

r = await api("POST", "/api/player/playback", { device: KEY, body: [{ mediaId: img1.id, playlistId: pl.id, playedAt: new Date().toISOString(), durationSeconds: 5 }, { mediaId: img1.id, playlistId: pl.id, playedAt: new Date().toISOString(), durationSeconds: 5 }] });
ok(r.status === 204, "player uploads proof-of-play");
r = await api("GET", `/api/devices/${dev.id}/playback`, { token: A });
ok(r.json[0]?.plays === 2 && r.json[0]?.seconds === 10, "playback report aggregates plays");

// ------------------------------------------------------------------------------------------
section("Multi-tenant isolation");
ok((await api("GET", `/api/devices/${dev.id}`, { token: B })).status === 404, "other org can't read the device");
ok((await api("GET", `/api/media/${img1.id}`, { token: B })).status === 404, "other org can't read media");
ok((await api("PUT", `/api/playlists/${pl.id}`, { token: B, body: { name: "hijack", shuffle: false, items: [] } })).status === 404, "other org can't modify playlists");
r = await api("GET", "/api/devices", { token: B }); ok(r.json.length === 0, "other org's device list is empty");
r = await api("POST", "/api/playlists", { token: B, body: { name: "sneaky", shuffle: false, items: [{ mediaAssetId: img1.id }] } });
ok(r.status === 400, "other org can't reference foreign media in a playlist");
r = await api("GET", "/api/layouts/templates", { token: B }); ok(r.json.every(t => t.id !== tpl.id), "each org gets its own templates");

// ------------------------------------------------------------------------------------------
section("Role-based permissions");
r = await api("GET", "/api/roles", { token: A }); const viewerRole = r.json.find(x => x.name === "Viewer");
ok(viewerRole && !viewerRole.permissions.includes("media.manage"), "system Viewer role is read-only");
r = await api("POST", "/api/users", { token: A, body: { email: `viewer-${uniq}@demo.local`, fullName: "Vic Viewer", password: "Viewer12345", roleIds: [viewerRole.id] } });
ok(r.status === 200, "owner adds a viewer user");
const V = (await api("POST", "/api/auth/login", { body: { email: `viewer-${uniq}@demo.local`, password: "Viewer12345" } })).json.accessToken;
ok((await api("GET", "/api/media", { token: V })).status === 200, "viewer can list media");
ok((await uploadImage(V, "nope", [0, 0, 0])).status === 403, "viewer can't upload (403)");
ok((await api("DELETE", `/api/schedules/${sched.id}`, { token: V })).status === 403, "viewer can't delete schedules (403)");
ok((await api("GET", "/api/audit-logs", { token: V })).status === 403, "viewer can't read the audit log");
r = await api("PUT", `/api/roles/${viewerRole.id}`, { token: A, body: { name: "Viewer", permissions: [] } });
ok(r.status === 403, "built-in roles can't be edited");
r = await api("POST", "/api/roles", { token: A, body: { name: `Media uploader ${uniq}`, permissions: ["media.view", "media.manage"] } });
ok(r.status === 200 && r.json.permissions.length === 2, "custom role created");

// ------------------------------------------------------------------------------------------
section("Subscription limits");
r = await api("GET", "/api/subscription", { token: B });
ok(r.json.plan === "Free" && r.json.maxDevices === 3, `Free plan: ${r.json.usage.devices}/${r.json.maxDevices} devices`);
const extra = [];
for (let i = r.json.usage.devices; i < r.json.maxDevices; i++) extra.push(await pairDevice(B, `Extra ${i} ${uniq}`));
ok(extra.every(e => e.paired.status === 200), "can pair up to the device limit");
const over = await pairDevice(B, `Over ${uniq}`);
ok(over.paired.status === 402, "pairing beyond the plan limit is refused (402)");
ok((await api("PUT", "/api/subscription", { token: V, body: { plan: "Pro" } })).status === 403, "only owners change the plan");
r = await api("PUT", "/api/subscription", { token: B, body: { plan: "Pro" } });
ok(r.status === 200 && r.json.maxDevices === 100, "upgrade to Pro raises limits");
ok((await api("POST", "/api/devices/pair", { token: B, body: { code: over.req.json.code, name: `Over ${uniq}` } })).status === 200, "pairing works after upgrade");

// ------------------------------------------------------------------------------------------
section("Offline detection, unpairing, audit, notifications");
await hub.conn.stop();
ok(await waitFor(async () => (await api("GET", `/api/devices/${dev.id}`, { token: A })).json.status === "Offline"), "device goes Offline when its connection drops");
ok(await waitFor(() => adminEvents.some(([t, p]) => t === "notification" && p.title === "Device offline")), "admin receives a live 'Device offline' notification");
const hub2 = deviceHub(KEY); await hub2.conn.start();
r = await api("DELETE", `/api/devices/${dev.id}`, { token: A });
ok(r.status === 204 && await waitFor(() => hub2.events.some(e => e.ev === "Revoked")), "unpaired device is told its key was revoked");
ok((await api("GET", "/api/player/manifest", { device: KEY })).status === 401, "revoked key can no longer sync");
await hub2.conn.stop(); await admin.stop();
r = await api("GET", "/api/audit-logs?pageSize=200", { token: A });
const actions = new Set(r.json.items.map(i => i.action));
ok(["device.paired", "media.uploaded", "playlist.created", "schedule.created", "device.command", "device.removed"].every(a => actions.has(a)), "audit log recorded every change");
r = await api("GET", "/api/notifications", { token: A });
ok(r.json.unreadCount > 0, `notifications stored (${r.json.unreadCount} unread)`);
r = await api("POST", "/api/notifications/read-all", { token: A });
ok((await api("GET", "/api/notifications", { token: A })).json.unreadCount === 0, "mark all notifications read");
r = await api("GET", "/api/dashboard", { token: A });
ok(r.status === 200 && typeof r.json.devicesOnline === "number" && r.json.mediaCount >= 3, "dashboard aggregates live data");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
