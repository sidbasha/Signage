# 4. Workflows

Each workflow has a **flowchart** showing decisions and error paths, and a **sequence diagram** showing which components call which. Status codes are the real ones the API returns. The complete journey from admin login to pixels on a screen is in [13-end-to-end-flow.md](13-end-to-end-flow.md).

## 4.1 User registration (new organization)

```mermaid
flowchart TD
    A([Visitor opens /register]) --> B[Fill organization, name, email, password]
    B --> C[POST /api/auth/register<br/>rate limit: 20/min/IP]
    C --> V{Valid?<br/>email has @, password ≥ 8 chars<br/>with a letter and a digit}
    V -- no --> E400[400 + field errors<br/>shown under each input]
    V -- yes --> U{Email already used<br/>by any organization?}
    U -- yes --> E409[409 An account with this email already exists]
    U -- no --> P["OrganizationProvisioner.Provision()"]
    P --> P1[Organization + unique slug]
    P --> P2[Subscription: Free plan limits]
    P --> P3["4 system roles: Owner, Admin, Editor, Viewer"]
    P --> P4[6 layout templates]
    P1 & P2 & P3 & P4 --> USR[User with PBKDF2 hash, role Owner]
    USR --> AUD[Audit: organization.registered]
    AUD --> TX["(Single SaveChanges transaction)"]
    TX --> TOK[Issue 15-min JWT + 14-day refresh token]
    TOK --> OK([200 AuthResponse → UI stores session, opens dashboard])
```

```mermaid
sequenceDiagram
    autonumber
    actor V as Visitor
    participant UI as Admin SPA
    participant AC as AuthController
    participant AS as AuthService
    participant OP as OrganizationProvisioner
    participant DB as PostgreSQL
    V->>UI: submit registration form
    UI->>AC: POST /api/auth/register {organizationName, fullName, email, password, timeZone}
    AC->>AS: RegisterAsync(request)
    AS->>AS: Validator (400 on failure)
    AS->>DB: SELECT Users WHERE Email = ? (IgnoreQueryFilters)
    alt email exists
        AS-->>UI: 409 problem+json
    else new
        AS->>OP: Provision(name, tz)
        OP-->>AS: org, subscription, roles, templates (tracked)
        AS->>DB: INSERT org, subscription, roles, role_permissions, layouts, zones, user, user_role, audit (one transaction)
        AS->>DB: INSERT RefreshToken (sha256 hash)
        AS-->>UI: 200 {accessToken, refreshToken, user{permissions[]}}
        UI->>UI: localStorage session, connect /hubs/admin
    end
```

## 4.2 Organization settings and location creation

```mermaid
flowchart TD
    A([Admin opens Locations]) --> P{Has locations.manage?}
    P -- no --> RO[Read-only list, no Add button<br/>API would return 403]
    P -- yes --> F[Add location dialog<br/>name, address, city, country, time zone]
    F --> R[POST /api/locations]
    R --> V{Name ≤ 120 chars and<br/>IANA time zone valid?}
    V -- no --> E[400 field errors]
    V -- yes --> S[Insert Location<br/>OrganizationId stamped by DbContext]
    S --> AU[Audit: location.created]
    AU --> OK([200 LocationDto])
    OK --> ED{Later: edit time zone?}
    ED -- yes --> CC[PUT /api/locations/id<br/>→ ContentChanged to org devices<br/>screens re-evaluate schedules in new zone]
    DEL([Delete location]) --> DD[Devices at location: LocationId = NULL<br/>fall back to org DefaultTimeZone<br/>→ ContentChanged]
    ORG([Settings: rename org / default time zone]) --> OU[PUT /api/organization<br/>organization.manage<br/>tz change → ContentChanged]
```

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin
    participant UI as Admin SPA
    participant LC as LocationsController
    participant LS as LocationService
    participant DB as PostgreSQL
    participant RT as SignalRNotifier
    A->>UI: Save location
    UI->>LC: POST /api/locations (Bearer, perm locations.manage)
    LC->>LS: CreateAsync(req)
    LS->>LS: validate name + TimeZoneInfo.TryFindSystemTimeZoneById
    LS->>DB: INSERT Locations + AuditLogs
    LS-->>UI: 200 LocationDto
    Note over A,RT: Editing the time zone later
    UI->>LC: PUT /api/locations/{id}
    LS->>DB: UPDATE
    LS->>RT: ContentChangedAsync(org)
    RT-->>RT: group org-devices:{org} ← "ContentChanged"
```

## 4.3 Device registration and pairing

Pairing never requires typing credentials on a TV remote. The screen shows a short code, an admin enters it in the CMS, and the screen then collects a long random device key exactly once.

```mermaid
flowchart TD
    subgraph Screen
        S0([App or /player starts]) --> S1{Device key in<br/>localStorage?}
        S1 -- yes --> PLAY([Go to playback §4.7])
        S1 -- no --> S2["POST /api/pairing<br/>{deviceType, hardwareId, resolution, appVersion, osVersion}"]
        S2 --> S3[Show 6-char code<br/>alphabet without 0/O/1/I · valid 15 min]
        S3 --> S4["poll GET /api/pairing/{id} every 3 s<br/>header X-Poll-Secret"]
        S4 --> S5{status}
        S5 -- Pending --> S4
        S5 -- Expired --> S2
        S5 -- "Paired + deviceKey" --> S6[Store key + deviceId] --> PLAY
        S5 -- "Paired, no key<br/>(already collected)" --> S2
    end
    subgraph Admin
        A1([Devices → Pair a screen]) --> A2[Enter code, name, location,<br/>orientation, default playlist, groups]
        A2 --> A3[POST /api/devices/pair<br/>perm devices.pair]
        A3 --> A4{Code pending<br/>and not expired?}
        A4 -- no --> A5[400: code invalid or expired]
        A4 -- yes --> A6{Devices < plan MaxDevices?}
        A6 -- no --> A7[402 Plan limit reached]
        A6 -- yes --> A8["Create Device<br/>key = 32 random bytes<br/>store SHA-256(key)"]
        A8 --> A9["PairingRequest: Paired, OrganizationId, DeviceId,<br/>PendingDeviceKey = key (handed out once)"]
        A9 --> A10[Audit device.paired + Notification 'Device paired'] --> A11([200 DeviceDto])
    end
    A9 -. next poll .-> S5
```

```mermaid
sequenceDiagram
    autonumber
    participant P as Player (TV/tablet/browser)
    participant PC as PairingController (anonymous)
    participant PS as PairingService
    actor A as Admin
    participant DC as DevicesController
    participant DS as DeviceService
    participant DB as PostgreSQL
    participant AH as AdminHub
    P->>PC: POST /api/pairing {deviceType:"AndroidTv", hardwareId, ...}
    PC->>PS: CreateAsync
    PS->>DB: expire stale pending codes, then INSERT PairingRequest(code, SHA-256(pollSecret))
    PS-->>P: {pairingId, code:"K7Q2MX", pollSecret, expiresAt, pollIntervalSeconds:3}
    loop every 3 s
        P->>PC: GET /api/pairing/{id} (X-Poll-Secret)
        PC-->>P: {status:"Pending"}
    end
    A->>DC: POST /api/devices/pair {code:"K7Q2MX", name, ...}
    DC->>DS: PairAsync
    DS->>DB: find Pending code, then count devices vs plan
    DS->>DB: INSERT Device(DeviceKeyHash), UPDATE PairingRequest(Paired, PendingDeviceKey)
    DS->>AH: Notification "Device paired"
    DS-->>A: 200 DeviceDto
    P->>PC: GET /api/pairing/{id}
    PC->>PS: StatusAsync
    PS->>DB: read key, then set PendingDeviceKey = NULL
    PS-->>P: {status:"Paired", deviceId, deviceKey}
    Note over P: every later call: Authorization: Device <deviceKey>
```

**Unpairing** (`DELETE /api/devices/{id}`) deletes the device row, which makes the key invalid immediately (401), and pushes `Revoked` over SignalR. The player wipes its key, manifest, media cache and play queue, and shows a new pairing code.

## 4.4 Media upload

```mermaid
flowchart TD
    A([Media page: drop files or click Upload]) --> PR["Browser probes file<br/>image: naturalWidth/Height<br/>video: videoWidth/Height + duration"]
    PR --> UP["XHR POST /api/media multipart<br/>file, width, height, durationSeconds<br/>progress bar per file"]
    UP --> L{Body ≤ 1 GB?}
    L -- no --> E413[413 from Kestrel]
    L -- yes --> X{Extension allowed?<br/>jpg jpeg png gif webp mp4 webm m4v}
    X -- no --> E400[400 unsupported type]
    X -- yes --> Q{used + size ≤ plan<br/>MaxStorageBytes?}
    Q -- no --> E402[402 storage limit]
    Q -- yes --> W["LocalFileStorage.SaveAsync<br/>stream to {org}/{id}.ext.uploading<br/>computing SHA-256 on the fly → atomic rename"]
    W --> DB[INSERT MediaAssets<br/>SizeBytes, Sha256, MimeType, dims, duration]
    DB --> OK{Saved?}
    OK -- no --> RB[Delete stored file · rethrow]
    OK -- yes --> RES([200 MediaDto with signed contentUrl<br/>/api/files/id?exp&sig, valid 6 h])
    WEB([Add web page]) --> WV[POST /api/media/web<br/>name, http/https URL, duration] --> RES
```

```mermaid
sequenceDiagram
    autonumber
    actor E as Editor
    participant UI as MediaPage
    participant MC as MediaController
    participant MS as MediaService
    participant FS as LocalFileStorage
    participant DB as PostgreSQL
    E->>UI: drop brand.mp4
    UI->>UI: probe() → 1920×1080, 30 s
    UI->>MC: POST /api/media (multipart, XHR progress)
    MC->>MS: UploadAsync(stream, fileName, length, meta)
    MS->>DB: SUM(SizeBytes) vs Subscription.MaxStorageBytes
    MS->>FS: SaveAsync(stream, "{org}/{id}.mp4")
    FS-->>MS: {size, sha256}
    MS->>DB: INSERT MediaAssets + AuditLogs
    MS-->>UI: 200 MediaDto
    UI->>UI: invalidate ["media"], toast "Uploaded"
```

Deleting media that any playlist uses returns **409** and names the playlists. The file is removed from disk only after the database row is gone.

## 4.5 Playlist creation

```mermaid
flowchart TD
    A([Playlists → New playlist]) --> C["POST /api/playlists {name, items: []}"]
    C --> ED[Editor page /playlists/:id]
    ED --> ADD[Click media in library panel → append item]
    ADD --> CFG["Per item: duration override (blank = media default),<br/>transition fade / slide / cut, reorder ↑↓, remove"]
    CFG --> META[Name, description, shuffle]
    META --> SAVE["PUT /api/playlists/{id}<br/>full replacement of items"]
    SAVE --> V{"≤ 500 items, durations 1 s–24 h,<br/>transitions valid, all media exist<br/>in this organization?"}
    V -- no --> E400[400]
    V -- yes --> R[Delete old items, insert new with SortOrder 0..n<br/>bump UpdatedAt]
    R --> AU[Audit playlist.updated]
    AU --> PUSH[ContentChanged → org devices]
    PUSH --> OK([200 PlaylistDto, UI shows 'Saved'])
```

```mermaid
sequenceDiagram
    autonumber
    actor E as Editor
    participant UI as PlaylistEditorPage
    participant PS as PlaylistService
    participant DB as PostgreSQL
    participant DH as DeviceHub
    participant P as Players
    E->>UI: add 3 items, set durations, Save
    UI->>PS: PUT /api/playlists/{id} {name, shuffle, items[]}
    PS->>DB: validate media ids belong to org (tenant filter)
    PS->>DB: DELETE PlaylistItems, then INSERT PlaylistItems, then UPDATE Playlists
    PS->>DH: ContentChanged → org-devices:{org}
    DH-->>P: ContentChanged
    P->>P: sync() with If-None-Match (§4.7)
    PS-->>UI: 200 PlaylistDto
```

## 4.6 Scheduling

### Creating a schedule

```mermaid
flowchart TD
    A([Schedules → New schedule]) --> F["Name, priority 0–100,<br/>play: playlist OR layout,<br/>start date, optional end date,<br/>days of week (bitmask), all day OR from–until,<br/>target groups and/or devices, active"]
    F --> R[POST /api/schedules]
    R --> V{"exactly one of layout/playlist<br/>end ≥ start<br/>both times or neither, start ≠ end<br/>days 1–127, priority 0–100<br/>≥1 target, targets exist<br/>layout is not a template"}
    V -- no --> E[400 with per-field errors]
    V -- yes --> S[INSERT Schedules + ScheduleTargets]
    S --> PUSH[ContentChanged → org devices] --> OK([200 ScheduleDto])
```

### Schedule evaluation on the screen

Schedules are evaluated **on the device**, in the device's time zone (the location's, or else the organization default), every 15 s. The server never tells a screen what to play right now, which is why screens keep switching content correctly with no network.

```mermaid
flowchart TD
    T([every 15 s and on manifest change]) --> N["localNow(manifest.device.timeZone)<br/>→ date, weekday, minutes"]
    N --> L[For each schedule, sorted by priority DESC then id]
    L --> H{"StartTime/EndTime set?"}
    H -- no --> AD{date in range and<br/>day bit set?}
    H -- "yes, start < end" --> DW{date in range, day bit set,<br/>start ≤ now < end?}
    H -- "yes, start > end<br/>(overnight)" --> ON{"now ≥ start: today's range + today's bit<br/>now < end: yesterday's range + yesterday's bit"}
    AD & DW & ON -- no --> NEXT[next schedule] --> L
    AD & DW & ON -- yes --> K{layout or playlist<br/>present in manifest<br/>and playlist not empty?}
    K -- no --> NEXT
    K -- yes --> WIN([Play it: first match wins])
    L -- none matched --> DEF{Default playlist?<br/>device default, else first group default by name}
    DEF -- yes --> DP([Play default playlist])
    DEF -- no --> IDLE([Idle screen: clock + device name])
```

Bitmask for `DaysOfWeek`: bit 0 = Sunday … bit 6 = Saturday. Common values: `127` every day, `62` weekdays, `65` weekends.

## 4.7 Content synchronization

```mermaid
flowchart TD
    TR([Trigger: startup · every 5 min · ContentChanged push ·<br/>SignalR reconnect · 'refresh' command]) --> G{Sync already running?}
    G -- yes --> Q[Mark pending → run once more after] --> END
    G -- no --> M["GET /api/player/manifest<br/>Authorization: Device key<br/>If-None-Match: &quot;cached version&quot;"]
    M --> R{response}
    R -- 401 --> REV[Key revoked → wipe everything → pairing]
    R -- network error / 5xx --> KEEP[Keep playing cached manifest<br/>show amber dot · retry later]
    R -- 304 --> ENS1["ensureMedia(cached): re-download<br/>anything the OS evicted"] --> END([done])
    R -- 200 --> ENS2["ensureMedia(new): for each image/video not in store<br/>download signed URL → SHA-256 → compare → store"]
    ENS2 --> OKM{all files verified?}
    OKM -- no --> KEEP
    OKM -- yes --> SWAP[Persist new manifest: atomic swap<br/>old content plays until this moment]
    SWAP --> PR[Prune files no longer referenced<br/>revoke unused object URLs] --> END
```

```mermaid
sequenceDiagram
    autonumber
    participant P as Player engine
    participant API as PlayerController
    participant SS as DeviceSyncService
    participant DB as PostgreSQL
    participant F as FilesController
    participant ST as MediaStore (Cache Storage / IndexedDB)
    P->>API: GET /api/player/manifest (Device key, If-None-Match "v1")
    API->>SS: BuildManifestAsync()
    SS->>DB: device, location TZ, groups, active schedules targeting device or its groups,<br/>layouts, playlists, media
    SS->>SS: version = SHA-256(content without signed URLs)[0..16]
    SS->>SS: add signed URLs (7-day expiry)
    API->>SS: TouchSyncAsync() → LastSyncAt, Online
    alt version == v1
        API-->>P: 304 Not Modified
    else changed
        API-->>P: 200 manifest, ETag "v2"
        loop each missing media file
            P->>F: GET /api/files/{id}?exp&sig
            F-->>P: bytes (range requests supported)
            P->>P: SHA-256(bytes) == manifest.sha256 ?
            P->>ST: put(key "/__signage-media/{id}/{sha}")
        end
        P->>P: localStorage manifest = v2, prune old keys
    end
```

**Manifest contents** (a real sample is in [API §5.12](05-api-reference.md#512-player-device-api)): device (id, name, orientation, time zone), `defaultPlaylistId`, active or future schedules, referenced layouts with zones, referenced playlists with items and effective durations, and media with type, MIME type, sha256, size and a signed URL (or `sourceUrl` for web pages).

## 4.8 Offline playback

```mermaid
flowchart TD
    B([Screen powers on with no network]) --> SH{How is the shell loaded?}
    SH -- "Android app" --> WV[WebView cache mode LOAD_CACHE_ELSE_NETWORK<br/>→ /player HTML + JS from HTTP cache]
    SH -- "Browser over HTTPS/localhost" --> SW[Service worker player-sw.js<br/>→ cached /player shell + /assets/*]
    SH -- "Browser over plain http" --> NS[No offline shell: browser shows error page<br/>use the Android app or HTTPS]
    WV & SW --> CR[Read device key + cached manifest<br/>from localStorage]
    CR --> PK["pickProgram() in device time zone"]
    PK --> RENDER[ZonePlayer reads blobs from MediaStore<br/>→ object URLs → img / video]
    RENDER --> LOOP["Advance on duration, or video 'ended'<br/>safety timer = max(dur) + 5 s"]
    LOOP --> POP["recordPlay() → localStorage queue ≤ 5000"]
    LOOP --> PK
    POP --> NET{Network back?}
    NET -- no --> LOOP
    NET -- yes --> UP["SignalR reconnects → Online, sync()<br/>heartbeat flushes plays in batches of 1000"]
```

What works offline: images and videos in every layout zone, schedule changes at the right local time, transitions, shuffle, and proof-of-play collection.
What doesn't: `Web` media (iframes need the network), new content, and remote commands.

## 4.9 Device heartbeat and status monitoring

```mermaid
flowchart TD
    subgraph Player
        H0([every 30 s, first after 3 s]) --> H1["payload: appVersion, osVersion, resolution,<br/>syncedVersion, currentItem, freeStorageBytes"]
        H1 --> H2{SignalR connected?}
        H2 -- yes --> H3[hub.invoke Heartbeat]
        H2 -- no --> H4[POST /api/player/heartbeat]
        H3 & H4 --> H5[flushPlays: POST /api/player/playback ≤ 1000]
    end
    subgraph Server
        H3 & H4 --> S1[DeviceSyncService.HeartbeatAsync<br/>update fields, LastSeenAt = now]
        S1 --> S2{was Offline?}
        S2 -- yes --> S3["Status = Online<br/>Notification 'Device back online'<br/>(skipped within 1 min of pairing)"]
        S2 -- no --> S4[Status = Online]
        S3 & S4 --> S5[AdminHub DeviceStatus → device wall updates]
        C1([DeviceHub connect]) --> S4
        C2([DeviceHub disconnect,<br/>last connection on node]) --> OFF
        M0([DeviceMonitor every 30 s]) --> M1{Online and<br/>LastSeenAt older than 90 s?}
        M1 -- yes --> OFF["Status = Offline<br/>Notification 'Device offline' (warning)<br/>AdminHub DeviceStatus + Notification"]
        M1 -- no --> M2([nothing])
    end
    OFF --> UI[Admin UI: tile turns grey 'No signal',<br/>toast, bell badge]
```

```mermaid
sequenceDiagram
    autonumber
    participant P as Player
    participant DH as DeviceHub
    participant SS as DeviceSyncService
    participant DB as PostgreSQL
    participant AH as AdminHub
    participant UI as Admin device wall
    P->>DH: connect (access_token = device key)
    DH->>SS: SetConnectedAsync(true)
    SS->>DB: Status=Online, LastSeenAt=now
    SS->>AH: DeviceStatus {id, status:"Online"}
    AH-->>UI: tile glows teal
    loop every 30 s
        P->>DH: Heartbeat({currentItem:"menu.mp4", syncedVersion, ...})
        DH->>SS: HeartbeatAsync
        SS->>DB: UPDATE Devices
    end
    Note over P: power cut, no clean disconnect
    loop DeviceMonitor every 30 s
        SS->>DB: SELECT Online devices with LastSeenAt < now-90 s (all tenants)
    end
    SS->>DB: Status=Offline + Notification
    SS->>AH: DeviceStatus Offline + Notification
    AH-->>UI: tile greys out, "Device offline" toast
```

## 4.10 Remote commands

| Command | Button (device page) | Player behaviour |
|---|---|---|
| `identify` | Identify | 10 s full-screen overlay with the device name, organization and content version |
| `refresh` | Sync now | Runs `sync()` immediately |
| `reload` | Restart player | Browser: `location.reload()`. Android: `SignageNative.reload()` (keeps the cache policy) |
| `clear-cache` | API only | Deletes all cached media and the manifest, then syncs from scratch |

Commands are fire-and-forget over SignalR (`202 Accepted`). A screen that is offline at that moment doesn't receive the command later.
