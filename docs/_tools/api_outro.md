
## 5.14 Real-time hubs (SignalR)

Clients use `@microsoft/signalr` 8 with the JSON protocol. Pass the credential through `accessTokenFactory`.

**`/hubs/admin`** (JWT). Joins group `org:{orgId}` on connect.

| Event | Payload |
|---|---|
| `DeviceStatus` | `{ id, status: "Online"|"Offline", lastSeenAt, currentItem, syncedVersion }` |
| `Notification` | `{ id, createdAt, severity, category, title, message, link, isRead }` |

**`/hubs/device`** (device key). Joins `device:{deviceId}` and `org-devices:{orgId}`. Connecting marks the device Online; the last disconnect marks it Offline.

| Direction | Name | Payload |
|---|---|---|
| server → device | `ContentChanged` | none: call `GET /api/player/manifest` with `If-None-Match` |
| server → device | `Command` | `{ command, payload }`, command ∈ `identify`, `refresh`, `reload`, `clear-cache` |
| server → device | `Revoked` | none: discard the key and cached content, show pairing |
| device → server | `Heartbeat(status)` | `{ appVersion, osVersion, resolution, syncedVersion, currentItem, freeStorageBytes }` |

```js
const conn = new signalR.HubConnectionBuilder()
  .withUrl("/hubs/device", { accessTokenFactory: () => deviceKey })
  .withAutomaticReconnect().build();
conn.on("ContentChanged", () => sync());
conn.on("Command", ({ command }) => handle(command));
conn.on("Revoked", () => forgetDevice());
await conn.start();
setInterval(() => conn.invoke("Heartbeat", { appVersion: "1.0", syncedVersion }), 30000);
```

## 5.15 Operational endpoints

| Path | Purpose |
|---|---|
| `GET /health` | Liveness: `Healthy` (text). Doesn't check the database. |
| `GET /swagger` · `/swagger/v1/swagger.json` | OpenAPI 3 UI and spec (when enabled) |
| `GET /player` | Web player |
| `GET /downloads/signage-player.apk` | Android app (served from `wwwroot/downloads`) |
| `GET /*` | Admin SPA (`index.html` fallback) |

## 5.16 Versioning and compatibility

The API is unversioned (`v1` in Swagger). Players in the field depend on `/api/pairing`, `/api/player/*`, `/api/files/*` and `/hubs/device`. Treat those as a **public contract**: add fields freely, but never remove or rename them. If a breaking change is unavoidable, add new routes (e.g. `/api/v2/player/manifest`) and keep the old ones until every screen has updated.
