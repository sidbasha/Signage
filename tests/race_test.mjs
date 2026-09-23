import * as signalR from "@microsoft/signalr";
const B = "http://localhost:5080"; const j = (m, p, b, t) => fetch(B + p, { method: m, headers: { "Content-Type": "application/json", ...(t && { Authorization: t }) }, body: b && JSON.stringify(b) }).then(async r => ({ s: r.status, j: await r.text().then(x => x ? JSON.parse(x) : null) }));
const A = "Bearer " + (await j("POST", "/api/auth/login", { email: "admin@demo.local", password: "Admin@12345" })).j.accessToken;
let serverErrors = 0;
for (let round = 0; round < 5; round++) {
  const pr = (await j("POST", "/api/pairing", { deviceType: "AndroidTv" })).j;
  const dev = (await j("POST", "/api/devices/pair", { code: pr.code, name: `race ${round}` }, A)).j;
  const key = (await j("GET", `/api/pairing/${pr.pairingId}`, undefined, undefined).catch(() => null), await fetch(`${B}/api/pairing/${pr.pairingId}`, { headers: { "X-Poll-Secret": pr.pollSecret } }).then(r => r.json())).deviceKey;
  const hub = new signalR.HubConnectionBuilder().withUrl(`${B}/hubs/device`, { accessTokenFactory: () => key }).configureLogging(signalR.LogLevel.None).build();
  await hub.start();
  const beats = Array.from({ length: 30 }, () => hub.invoke("Heartbeat", { appVersion: "x" }).catch(() => {}));
  const rest = Array.from({ length: 10 }, () => j("POST", "/api/player/heartbeat", { appVersion: "x" }, `Device ${key}`).then(r => { if (r.s >= 500) serverErrors++; }));
  await j("DELETE", `/api/devices/${dev.id}`, undefined, A);
  await Promise.all([...beats, ...rest]); await hub.stop();
}
console.log(serverErrors ? `FAIL: ${serverErrors} HTTP 5xx` : "no HTTP 5xx during 5 unpair-while-heartbeating races");
