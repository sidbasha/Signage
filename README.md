# Signage CMS

A multi-tenant digital signage platform: organizations manage Android TVs, Android tablets and web players across locations, and push media, playlists, multi-zone layouts and schedules to them in real time. Screens keep playing, and keep following their schedules, when the network is down.

**Stack:** .NET 8 · ASP.NET Core Web API · EF Core 8 · PostgreSQL · JWT · SignalR · Swagger | React 18 · Vite · TypeScript · Tailwind · shadcn/ui · TanStack Query

Full technical documentation: **[docs/README.md](docs/README.md)** (architecture, ERD, workflows, API, players, deployment, security).

## Run it locally

Prerequisites: .NET 8 SDK, Node 20+, PostgreSQL 14+.

```bash
# 1. Database (once)
createuser -P signage          # password: signage_dev_pw (or change ConnectionStrings:Default)
createdb -O signage signage

# 2. API on http://localhost:5080. Creates the schema and a demo org on first start.
cd backend/src/SignageCms.Api
dotnet run
#   Swagger:  http://localhost:5080/swagger
#   Sign in:  admin@demo.local / Admin@12345   (Development only, see appsettings.Development.json)

# 3a. Admin UI with hot reload on http://localhost:5173 (proxies /api and /hubs to 5080)
cd frontend && npm install && npm run dev

# 3b. Or serve everything from the API: builds the UI into the API's wwwroot
cd frontend && npm run build:api      # then open http://localhost:5080
```

**Try the full loop:** open `http://localhost:5080/player` in a second browser window (or on a TV). It shows a 6-character code. In the admin UI, go to **Devices → Pair a screen**, enter the code, pick a default playlist, and the player starts playing within seconds.

### Screens: Android TV, Android tablets and browsers

- **Android TV and tablets:** install the **Signage Player** app from `android/` (prebuilt at `/downloads/signage-player.apk` on your server), enter the server address, and pair. See [android/README.md](android/README.md) for step-by-step TV sideloading.
- **Any browser** (smart-TV browser, stick PC, kiosk): open `http://<server-ip>:5080/player`.
- Screens must reach the server over the network. `dotnet run` binds `0.0.0.0:5080`; open port 5080 in the firewall.

### Docker

```bash
JWT_SIGNING_KEY=$(openssl rand -hex 32) SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='ChangeMe123' docker compose up --build
# http://localhost:8080
```

### Configuration (environment variables)

| Setting | Purpose |
|---|---|
| `ConnectionStrings__Default` | PostgreSQL connection string |
| `Jwt__SigningKey` | **Required.** 32+ random bytes. Signs access tokens and media URLs. The API refuses to start without it. |
| `Jwt__AccessTokenMinutes` | Access token lifetime (default 15). Refresh tokens last 14 days and rotate on every use. |
| `Storage__RootPath` | Where uploaded media is stored (default `./storage`) |
| `Cors__AllowedOrigins__0` | Admin UI origin if it's hosted on a different domain |
| `Swagger__Enabled` | Expose `/swagger` (off by default outside Development) |
| `Seed__AdminEmail` / `Seed__AdminPassword` / `Seed__OrganizationName` | Optional first-run owner account |

## Architecture

```
backend/src
  SignageCms.Domain          Entities and enums. No dependencies.
  SignageCms.Application     Use cases (one service per feature), validation, permissions, plan limits.
                             Depends only on abstractions: IAppDbContext, IFileStorage, IRealtimeNotifier, ...
  SignageCms.Infrastructure  EF Core + PostgreSQL, JWT, PBKDF2 passwords, HMAC URL signing, local file storage.
  SignageCms.Api             Thin controllers, auth schemes, SignalR hubs, background offline monitor.
frontend/src
  pages/, components/        Admin UI
  player/                    Web player: engine.ts (sync, cache, scheduling) + PlayerApp.tsx
tests/
  e2e.mjs                    81 API/SignalR checks
  browser_e2e.py             19 Playwright checks driving the real UI and a real player
  lan_player_test.py         8 checks: player over plain http on a LAN IP with an Android TV user agent
android/                     Android TV + tablet kiosk app (Java, no Gradle), build.sh → signed APK
```

**Multi-tenancy.** Every tenant-owned row carries `OrganizationId`. EF global query filters scope every query to the caller's organization, with "no organization" matching nothing. `SaveChanges` stamps new rows and throws on any cross-tenant write. Cross-tenant IDs return 404, never 403, so existence doesn't leak.

**Authorization.** 23 permission codes, 4 built-in roles (Owner, Admin, Editor, Viewer) plus custom roles. Permissions are embedded in the JWT and checked with `[HasPermission("media.manage")]`. The UI hides what the role can't do, and the API enforces it.

**Devices.** Players use a separate `Device` auth scheme with per-device keys, stored only as SHA-256 hashes.
1. **Pairing:** the player calls `POST /api/pairing` and gets a code plus a poll secret. An admin claims the code (`POST /api/devices/pair`). The player polls and collects its device key exactly once.
2. **Sync:** `GET /api/player/manifest` returns everything needed to run offline: device time zone, schedules, layouts, playlists, and media with sha256 and signed URLs. The version is a content hash, so an unchanged manifest costs one `304`.
3. **Push:** a SignalR `/hubs/device` connection receives `ContentChanged`, `Command` (identify, refresh, reload, clear-cache) and `Revoked`. Connect and disconnect drive online/offline status. A background sweep marks silent devices offline after 90 s.
4. **Offline:** the player downloads media into Cache Storage, verifies each file's sha256, and only switches to a new manifest once every file is present. It evaluates schedules on the device in its location's time zone, including overnight windows. A service worker caches the app shell, so a screen that reboots with no network still plays. Proof-of-play is queued locally and uploaded when back online.

Adding a device type (for example Tizen or webOS) needs no schema change: `DeviceType` is stored as text, and any client that speaks the four player endpoints above works.

### Database tables

Organizations, Subscriptions, Locations, Users, Roles, Permissions, RolePermissions, UserRoles, RefreshTokens, Devices, DeviceGroups, DeviceGroupMembers, PairingRequests, PlaybackLogs, MediaAssets, Playlists, PlaylistItems, Layouts, LayoutZones, Schedules, ScheduleTargets, Notifications, AuditLogs.

### Main endpoints (full list in Swagger)

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register · login · refresh · logout`, `GET /api/auth/me` |
| Org | `GET/PUT /api/organization`, `GET/PUT /api/subscription`, `GET /api/dashboard`, `GET /api/timezones` |
| People | `/api/users`, `/api/roles`, `GET /api/permissions` |
| Screens | `/api/locations`, `/api/devices` (`POST pair`, `POST {id}/commands`, `GET {id}/playback`), `/api/device-groups` |
| Content | `/api/media` (multipart upload up to 1 GB, `POST web`), `GET /api/files/{id}?exp&sig` (signed, range requests), `/api/playlists`, `/api/layouts` (`GET templates`, `POST from-template/{id}`), `/api/schedules` |
| Activity | `/api/notifications` (`POST {id}/read`, `POST read-all`), `GET /api/audit-logs` |
| Player | `POST /api/pairing`, `GET /api/pairing/{id}`, `GET /api/player/manifest`, `POST /api/player/heartbeat`, `POST /api/player/playback` |
| Realtime | `/hubs/admin` (JWT): `DeviceStatus`, `Notification`. `/hubs/device` (device key): `ContentChanged`, `Command`, `Revoked`, invoke `Heartbeat` |

## Tests

With the API running:

```bash
cd tests && npm install && node e2e.mjs          # 81 checks: auth, tenancy, RBAC, pairing, sync, SignalR, quotas, audit
pip install playwright && playwright install chromium
python3 browser_e2e.py                           # 19 checks in a real browser, including offline reboot of a player
```

## Known limitations

- **Schema creation uses `EnsureCreated()`.** Before the first production release, run `dotnet ef migrations add Initial` and switch the seeder to `Database.MigrateAsync()`, so future schema changes can be applied without data loss.
- **Android app is a WebView kiosk shell**, targeting API 23 so it builds without Gradle. That's fine for sideloading; publishing to Google Play needs a Gradle port with a newer target SDK. It hasn't been run on physical hardware in this environment.
- **Single-node assumptions.** Media is stored on local disk (`IFileStorage` is the swap point for S3 or Azure Blob). SignalR runs without a backplane, and presence connection counts are kept in memory. Running several API instances needs a Redis backplane and shared storage.
- **Billing is not connected.** Plans and limits are fully enforced, but changing plans doesn't charge anyone. Connect Stripe or similar before selling.
- **No transcoding or thumbnails.** Media is served as uploaded, so upload H.264 MP4 for the widest device support. Web-page media needs the network and can't be cached offline.
- **Notification read state is shared per organization**, not tracked per user.
- **No email flows yet:** invites, password reset and email verification. Admins set initial passwords.
