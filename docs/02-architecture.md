# 2. System architecture

## 2.1 Context

Who and what talks to the system.

```mermaid
flowchart LR
    subgraph People
        OWN([Owner / Admin])
        ED([Editor])
        VW([Viewer])
    end
    subgraph Screens
        ATV[[Android TV<br/>Signage Player app]]
        ATAB[[Android tablet<br/>Signage Player app]]
        WEB[[Browser / smart-TV browser<br/>/player]]
    end
    CMS["(Signage CMS<br/>API + Admin UI + Web player)"]
    PG["(PostgreSQL 16)"]
    FS["(Media storage<br/>local disk)"]
    OWN & ED & VW -- HTTPS: admin UI, REST, SignalR --> CMS
    ATV & ATAB & WEB -- HTTP/S: pairing, manifest, files, heartbeat, SignalR --> CMS
    CMS -- EF Core / Npgsql --> PG
    CMS -- streamed files --> FS
    WEBSRC["(External web pages<br/>for 'Web' media)"] -. iframe, online only .- ATV & ATAB & WEB
```

## 2.2 High-level architecture

A single deployable ASP.NET Core process serves three front ends and two real-time hubs:

```mermaid
flowchart TB
    subgraph Clients
        ADMIN["Admin SPA<br/>React 18 + Vite + TS + Tailwind + shadcn/ui<br/>TanStack Query, SignalR client"]
        PLAYER["Web player (/player)<br/>separate lazy chunk ~15 KB<br/>engine.ts + PlayerApp.tsx"]
        ANDROID["Android app<br/>Java WebView kiosk shell<br/>wraps /player + native bridge"]
    end

    subgraph API["ASP.NET Core 8 process"]
        direction TB
        STATIC["Static files + SPA fallback<br/>wwwroot: admin UI, player, APK"]
        REST["REST controllers<br/>/api/*"]
        HUBA["AdminHub<br/>/hubs/admin (JWT)"]
        HUBD["DeviceHub<br/>/hubs/device (Device key)"]
        APP["Application services<br/>business rules, validation,<br/>permissions, plan limits"]
        INFRA["Infrastructure<br/>EF Core DbContext, JWT, PBKDF2,<br/>HMAC URL signer, file storage"]
        MON["DeviceMonitor<br/>BackgroundService (30 s sweep)"]
        SWAG["Swagger / OpenAPI"]
    end

    DB["(PostgreSQL)"]
    DISK["(Storage:RootPath<br/>media files)"]

    ADMIN -- "REST (Bearer JWT)" --> REST
    ADMIN <-- "WebSocket" --> HUBA
    PLAYER -- "REST (Device key)" --> REST
    PLAYER <-- "WebSocket" --> HUBD
    ANDROID -- "loads" --> PLAYER
    ADMIN & PLAYER -. "GET /api/files/{id}?exp&sig" .-> REST
    REST --> APP
    HUBD --> APP
    MON --> APP
    APP -- "IRealtimeNotifier" --> HUBA & HUBD
    APP --> INFRA
    INFRA --> DB
    INFRA --> DISK
```

**Key properties**

| Property | How it's achieved |
|---|---|
| Multi-tenant isolation | `OrganizationId` on every tenant row, EF global query filters, and a cross-tenant write guard in `SaveChangesAsync` ([Database §3.6](03-database.md#36-multi-tenancy-enforcement)) |
| Real-time | SignalR: admin UIs join `org:{id}`; players join `device:{id}` and `org-devices:{orgId}` |
| Offline-first players | Full manifest + sha256-verified media cache + on-device schedule evaluation in the screen's time zone |
| Extensible device types | `DeviceType` stored as text; any client that implements the 5 player endpoints works ([Players §8.5](08-players.md#85-device-protocol-for-new-device-types)) |
| Stateless API (mostly) | JWTs, DB-backed state. The exceptions (single-node) are local media storage and the in-memory SignalR group and connection counts; see [§2.8](#28-deployment-topology-and-scaling) |

## 2.3 Clean architecture layers

```mermaid
flowchart LR
    API["SignageCms.Api<br/>controllers, hubs, auth handlers,<br/>middleware, background service,<br/>Program.cs composition root"]
    APPL["SignageCms.Application<br/>services (use cases), DTOs,<br/>validation, permissions, plans,<br/>abstractions (interfaces)"]
    INF["SignageCms.Infrastructure<br/>AppDbContext, EF configurations,<br/>DbSeeder, JwtTokenService,<br/>IdentityPasswordHasher, HmacUrlSigner,<br/>LocalFileStorage"]
    DOM["SignageCms.Domain<br/>entities, enums, BaseEntity,<br/>ITenantEntity"]
    API --> APPL
    API --> INF
    INF --> APPL
    APPL --> DOM
    INF --> DOM
```

Dependency rule: **Domain** depends on nothing. **Application** depends on Domain and on EF Core abstractions only (`IAppDbContext` exposes `DbSet<T>`). **Infrastructure** implements Application's interfaces. **Api** wires everything together and holds no business rules; every controller action is a one-line call into a service.

| Abstraction (Application) | Implementation | Layer |
|---|---|---|
| `IAppDbContext` | `AppDbContext` (EF Core + Npgsql) | Infrastructure |
| `ICurrentUser` | `HttpCurrentUser` (claims of the JWT or device principal) | Api |
| `IPasswordHasher` | `IdentityPasswordHasher` (PBKDF2, ASP.NET Identity v3) | Infrastructure |
| `ITokenService` | `JwtTokenService` (HS256) | Infrastructure |
| `IUrlSigner` | `HmacUrlSigner` (HMAC-SHA256, key derived from `Jwt:SigningKey`) | Infrastructure |
| `IFileStorage` | `LocalFileStorage` (streaming write + sha256) | Infrastructure |
| `IRealtimeNotifier` | `SignalRNotifier` | Api |
| `IClock` | `SystemClock` | Application |

## 2.4 Low-level: request pipeline

Middleware in the order registered in `Program.cs`:

```mermaid
flowchart TB
    IN([Incoming request]) --> FH[UseForwardedHeaders<br/>X-Forwarded-For / -Proto]
    FH --> EH[ErrorHandlingMiddleware<br/>exceptions → RFC 7807 problem+json]
    EH --> SC[UseStatusCodePages]
    SC --> SW{Swagger:Enabled?}
    SW -- yes --> SWG[UseSwagger / UseSwaggerUI]
    SW -- no --> DF
    SWG --> DF[UseDefaultFiles]
    DF --> SF[UseStaticFiles<br/>wwwroot, +.apk MIME]
    SF -- file found --> OUTF([200 static file])
    SF -- not a file --> CORS[UseCors<br/>Cors:AllowedOrigins]
    CORS --> RL[UseRateLimiter<br/>'auth' 20/min/IP · 'pairing' 60/min/IP]
    RL --> AUTHN[UseAuthentication<br/>JWT Bearer default · Device scheme]
    AUTHN --> AUTHZ[UseAuthorization<br/>HasPermission policies]
    AUTHZ --> EP{Endpoint}
    EP -- /api/* --> CTRL[Controller → Service → DbContext]
    EP -- /hubs/admin --> HA[AdminHub]
    EP -- /hubs/device --> HD[DeviceHub]
    EP -- /health --> HC[Health check]
    EP -- anything else --> FB[MapFallbackToFile index.html<br/>SPA client routing]
```

## 2.5 Low-level: authentication and authorization

```mermaid
flowchart LR
    subgraph Schemes
        JWT["JwtBearer (default)<br/>Authorization: Bearer &lt;jwt&gt;<br/>or ?access_token= on /hubs/admin"]
        DEVS["Device scheme<br/>Authorization: Device &lt;key&gt;<br/>on /hubs/device also Bearer or ?access_token="]
    end
    JWT --> CL1["claims: sub, email, name, jti,<br/>org, org_name, role*, perm*"]
    DEVS --> LK["SHA-256(key) → Devices.DeviceKeyHash<br/>(unique index, IgnoreQueryFilters)"]
    LK --> CL2["claims: device, org, name, role=Device"]
    CL1 --> POL["[HasPermission('media.manage')]<br/>→ policy 'perm:media.manage'<br/>→ PermissionHandler checks perm claim"]
    CL2 --> DEVEP["[Authorize(Scheme=Device)]<br/>PlayerController, DeviceHub"]
```

- Permission policies are built on demand by `PermissionPolicyProvider` and always use the JWT scheme, so a device key can never satisfy an admin endpoint and a JWT can never call the player API (both are covered by tests).
- Access tokens last 15 minutes. Refresh tokens last 14 days, are stored as SHA-256 hashes, and rotate on every use. Presenting an already-rotated refresh token revokes every active session of that user (theft detection).

## 2.6 Low-level: real-time channels

```mermaid
flowchart LR
    subgraph AdminHub["/hubs/admin (JWT)"]
        G1["group org:{orgId}"]
    end
    subgraph DeviceHub["/hubs/device (Device key)"]
        G2["group device:{deviceId}"]
        G3["group org-devices:{orgId}"]
        HB["invoke Heartbeat(HeartbeatRequest)"]
    end
    SVC[Application services] -- ContentChangedAsync --> G3
    SVC -- SendDeviceCommandAsync --> G2
    SVC -- DeviceRevokedAsync --> G2
    SVC -- DeviceStatusChangedAsync --> G1
    SVC -- NotificationCreatedAsync --> G1
```

| Hub | Server → client | Payload | Client → server |
|---|---|---|---|
| AdminHub | `DeviceStatus` | `{ id, status, lastSeenAt, currentItem, syncedVersion }` | none |
| AdminHub | `Notification` | `NotificationDto` | |
| DeviceHub | `ContentChanged` | none: the player re-fetches its manifest with `If-None-Match` | `Heartbeat(HeartbeatRequest)` |
| DeviceHub | `Command` | `{ command: "identify" \| "refresh" \| "reload" \| "clear-cache", payload }` | |
| DeviceHub | `Revoked` | none: the player wipes its key and cache and returns to pairing | |

`ContentChanged` is broadcast to **all** devices in the organization. Each player answers with a conditional manifest request, and screens whose content didn't change get a `304` (a few hundred bytes). That keeps change detection in one place (the manifest hash) and avoids computing affected-device sets on every edit. At very large fleets, see [§2.8](#28-deployment-topology-and-scaling).

Presence: `DeviceHub.OnConnectedAsync` marks the device Online. `OnDisconnectedAsync` marks it Offline only when that node's per-device connection count reaches 0, so a page reload doesn't flap the status. `DeviceMonitor` marks devices Offline when `LastSeenAt` is older than 90 s (for example after a power cut with no clean disconnect).

## 2.7 Player architecture

```mermaid
flowchart TB
    subgraph Shell["Shell (either)"]
        BR["Browser tab<br/>service worker caches app shell (HTTPS/localhost only)"]
        AND["Android MainActivity<br/>WebView, immersive, keep-screen-on,<br/>boot start, cache-else-network when offline"]
    end
    subgraph PlayerApp["PlayerApp.tsx (React)"]
        PAIR[Pairing screen<br/>code + poll every 3 s]
        PLAY[Playing<br/>timers: sync 5 min · heartbeat 30 s ·<br/>schedule eval 15 s · plays flush 30 s]
        ZP[ZonePlayer ×N<br/>image / video / iframe · fade / slide]
    end
    subgraph Engine["engine.ts + store.ts (no React)"]
        CRED[credentials<br/>localStorage]
        SYNC["sync(): manifest ETag,<br/>download, verify sha256, atomic swap, prune"]
        STORE["MediaStore<br/>Cache Storage (secure ctx)<br/>or IndexedDB (plain http)"]
        SCHED["pickProgram(): schedules in device TZ,<br/>overnight windows, priority"]
        POP[proof-of-play queue<br/>localStorage, cap 5000]
        NB["window.SignageNative<br/>(Android bridge, optional)"]
    end
    BR & AND --> PlayerApp
    PAIR --> CRED
    PLAY --> SYNC --> STORE
    PLAY --> SCHED --> ZP
    ZP --> STORE
    ZP --> POP
    NB -.-> PAIR
```

## 2.8 Deployment topology and scaling

**Reference deployment (single node)**, which is what `docker-compose.yml` produces:

```mermaid
flowchart LR
    U([Admins]) -- HTTPS 443 --> RP[Reverse proxy<br/>nginx / Caddy / cloud LB<br/>TLS, WebSocket upgrade]
    S([Screens on LAN / internet]) -- HTTP/S --> RP
    RP -- :8080 --> APP[signage-cms container<br/>API + UI + player + APK]
    APP --> DB["(postgres:16<br/>volume pgdata)"]
    APP --> VOL["(volume media<br/>/data/media)"]
```

**Scaling out (multi-node): required changes**

```mermaid
flowchart LR
    LB[Load balancer<br/>sticky sessions or WebSockets-only] --> A1[API node 1] & A2[API node 2] & A3[API node N]
    A1 & A2 & A3 --> PG["(PostgreSQL<br/>primary + read replica)"]
    A1 & A2 & A3 --> BLOB["(S3 / Azure Blob<br/>IFileStorage impl)"]
    A1 & A2 & A3 <--> RED["(Redis<br/>SignalR backplane)"]
    CDN[CDN] -. signed media URLs .-> BLOB
```

| Concern today | Change for multi-node |
|---|---|
| `LocalFileStorage` | Implement `IFileStorage` for S3 or Azure Blob; serve media through a CDN with the same HMAC-signed URLs, or with provider pre-signed URLs |
| SignalR groups are per node | `AddSignalR().AddStackExchangeRedis(...)` |
| `DeviceHub` connection counting is in memory | Move counts to Redis, or rely on `DeviceMonitor` (90 s) as the source of truth |
| `DeviceMonitor` runs on every node | Harmless (idempotent), but add a distributed lock to avoid duplicate "Device offline" notifications |
| Data Protection keys (not used for auth today) | Persist to a shared store if cookies or antiforgery are added later |
| `EnsureCreated()` at startup | Switch to EF migrations run once by a deploy job ([Deployment §9.4](09-deployment.md#94-database-migrations)) |

## 2.9 Technology stack

| Area | Technology | Version |
|---|---|---|
| Backend runtime | .NET / ASP.NET Core | 8.0 |
| ORM / DB driver | EF Core, Npgsql.EntityFrameworkCore.PostgreSQL | 8.0.11 |
| Database | PostgreSQL | 14+ (tested 16) |
| Auth | Microsoft.AspNetCore.Authentication.JwtBearer, System.IdentityModel.Tokens.Jwt | 8.0.11, 7.1.2 |
| API docs | Swashbuckle.AspNetCore | 6.5.0 |
| Real-time | ASP.NET Core SignalR (JSON protocol) | 8.0 |
| Admin UI | React, React Router, TanStack Query, Tailwind CSS, shadcn/ui (Radix), lucide-react, sonner | 18, 6, 5, 3, n/a, n/a, 2 |
| Build | Vite, TypeScript | 5, 5.6 |
| Real-time client | @microsoft/signalr | 8 |
| Android app | Java 8 source, Android SDK platform 23, minSdk 21; built with aapt/javac/dx/apksigner | n/a |
| Tests | Node 20+ (e2e.mjs), Python 3 + Playwright (Chromium) | n/a |
