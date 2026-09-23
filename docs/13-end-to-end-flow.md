# 13. End-to-end flow: admin login to content on screen

This walks through one realistic journey across every component: an admin signs in, uploads a video, builds a playlist, pairs a new Android TV, and schedules a breakfast menu. The TV then plays it, including through a network outage. Each step references the detailed workflow.

## 13.1 Journey overview

```mermaid
flowchart LR
    A[1 Sign in] --> B[2 Upload media] --> C[3 Build playlist] --> D[4 Screen shows code] --> E[5 Admin pairs] --> F[6 Screen syncs + verifies] --> G[7 Schedule] --> H[8 Push + re-sync] --> I[9 On-device schedule → playback] --> J[10 Heartbeat, proof-of-play, offline, recovery]
```

## 13.2 Swimlane view

```mermaid
flowchart TB
    subgraph Admin["Admin (browser)"]
        A1([Open CMS]) --> A2[Sign in]
        A2 --> A3[Upload breakfast.mp4]
        A3 --> A4[Create playlist 'Breakfast']
        A4 --> A5[Devices → Pair a screen<br/>enter code, default playlist]
        A5 --> A6[Create schedule<br/>Mon–Fri 07:00–11:00, priority 20]
        A6 --> A7[Device wall: Lobby TV live,<br/>'Now playing breakfast']
    end
    subgraph API["Signage CMS API"]
        B1[AuthService: JWT + refresh]
        B2[MediaService: stream, sha256, quota]
        B3[PlaylistService]
        B4[PairingService: code + poll secret]
        B5[DeviceService.Pair: key hash, one-time hand-off]
        B6[ScheduleService → ContentChanged]
        B7[DeviceSyncService: manifest v1 → v2, ETag]
        B8[DeviceSyncService: heartbeat, presence, playback]
        B9[DeviceMonitor: offline after 90 s]
    end
    subgraph TV["Android TV (Signage Player app)"]
        C1([Boot → MainActivity]) --> C2[Setup: server URL → /health OK]
        C2 --> C3[WebView loads /player → shows code]
        C3 --> C4[Collects device key]
        C4 --> C5[Sync: manifest, download, verify, cache]
        C5 --> C6[Plays default playlist]
        C6 --> C7[ContentChanged → re-sync]
        C7 --> C8[07:00 local: schedule wins → breakfast.mp4]
        C8 --> C9[Heartbeats + proof-of-play]
    end
    A2 --> B1
    A3 --> B2
    A4 --> B3
    C3 --> B4
    A5 --> B5 --> C4
    C5 --> B7
    A6 --> B6 --> C7
    C7 --> B7
    C9 --> B8 --> A7
    B9 -. if silent .-> A7
```

## 13.3 Complete sequence

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant UI as Admin SPA
    participant API as CMS API
    participant DB as PostgreSQL
    participant FS as Media storage
    participant AH as AdminHub
    participant DH as DeviceHub
    participant TV as Android TV (app + /player)

    rect rgb(240, 246, 248)
    Note over Admin,DB: 1 · Sign in (§4.1)
    Admin->>UI: email + password
    UI->>API: POST /api/auth/login
    API->>DB: user by email, verify PBKDF2, store refresh-token hash, audit
    API-->>UI: accessToken (15 min) + refreshToken (14 d) + permissions
    UI->>AH: connect /hubs/admin?access_token=… → group org:{id}
    end

    rect rgb(240, 246, 248)
    Note over Admin,FS: 2–3 · Media and playlist (§4.4, §4.5)
    Admin->>UI: drop breakfast.mp4
    UI->>UI: probe 1920×1080, 30 s
    UI->>API: POST /api/media (multipart, progress)
    API->>FS: stream to {org}/{id}.mp4, SHA-256 on the fly
    API->>DB: MediaAssets (+ quota check), audit
    API-->>UI: MediaDto (signed contentUrl)
    Admin->>UI: New playlist, add video, Save
    UI->>API: POST /api/playlists, then PUT /api/playlists/{id}
    API->>DB: Playlists + PlaylistItems, audit
    API->>DH: ContentChanged (org devices, none yet)
    end

    rect rgb(248, 246, 240)
    Note over TV,DB: 4 · Screen boots and asks to pair (§4.3)
    TV->>TV: BootReceiver → MainActivity → setup: GET /health = Healthy
    TV->>API: GET /player (WebView)
    TV->>API: POST /api/pairing {deviceType: AndroidTv, hardwareId, model…}
    API->>DB: PairingRequest(code K7Q2MX, pollSecret hash, 15 min)
    API-->>TV: {pairingId, code, pollSecret}
    TV->>TV: show "K7Q 2MX"
    loop every 3 s
        TV->>API: GET /api/pairing/{id} (X-Poll-Secret) → Pending
    end
    end

    rect rgb(248, 246, 240)
    Note over Admin,TV: 5 · Admin pairs
    Admin->>UI: Pair a screen: K7Q2MX, "Lobby TV", default playlist Breakfast
    UI->>API: POST /api/devices/pair
    API->>DB: plan check, Device(SHA-256 key), PairingRequest Paired + one-time key
    API->>AH: Notification "Device paired"
    AH-->>UI: toast
    TV->>API: GET /api/pairing/{id}
    API->>DB: read key, clear it
    API-->>TV: {status: Paired, deviceKey}
    TV->>TV: localStorage creds
    end

    rect rgb(240, 248, 242)
    Note over TV,FS: 6 · First sync (§4.7)
    TV->>DH: connect /hubs/device (device key)
    DH->>DB: Status Online
    DH->>AH: DeviceStatus Online
    AH-->>UI: Lobby TV tile glows
    TV->>API: GET /api/player/manifest (Device key)
    API->>DB: device, TZ Asia/Kolkata, groups, schedules, playlists, media
    API-->>TV: 200 manifest v1 (ETag), signed URLs
    TV->>API: GET /api/files/{id}?exp&sig
    API->>FS: read (range support)
    API-->>TV: bytes
    TV->>TV: SHA-256 == manifest.sha256 → store (IndexedDB on http, Cache Storage on https)
    TV->>TV: save manifest v1 → play default playlist Breakfast
    end

    rect rgb(240, 248, 242)
    Note over Admin,TV: 7–8 · Schedule and push (§4.6)
    Admin->>UI: Schedule "Breakfast menu", Mon–Fri 07:00–11:00, priority 20, target Lobby TV
    UI->>API: POST /api/schedules
    API->>DB: Schedules + ScheduleTargets, audit
    API->>DH: ContentChanged → org-devices:{org}
    DH-->>TV: ContentChanged
    TV->>API: GET /api/player/manifest (If-None-Match v1)
    API-->>TV: 200 manifest v2 (schedule added, media already cached, nothing to download)
    end

    rect rgb(246, 240, 248)
    Note over TV: 9 · Playback decided on the device (§4.6)
    loop every 15 s
        TV->>TV: localNow(Asia/Kolkata) → Tue 07:00 → "Breakfast menu" active (priority 20)
    end
    TV->>TV: ZonePlayer: object URL from local store → video element (autoplay, muted), ended → loop
    end

    rect rgb(246, 240, 248)
    Note over Admin,TV: 10 · Monitoring, proof-of-play, outage (§4.8, §4.9)
    loop every 30 s
        TV->>DH: Heartbeat {currentItem: breakfast, syncedVersion: v2}
        DH->>DB: LastSeenAt, CurrentItem
        TV->>API: POST /api/player/playback [plays]
    end
    Note over TV: network cable unplugged
    TV->>TV: keeps playing from local store, queues plays, amber dot
    API->>DB: DeviceMonitor: LastSeenAt older than 90 s → Offline
    API->>AH: DeviceStatus Offline + Notification "Device offline"
    AH-->>UI: tile greys, toast
    Note over TV: network restored
    TV->>DH: reconnect (back-off ≤ 30 s) → Online, "Device back online"
    TV->>API: manifest If-None-Match v2 → 304
    TV->>API: POST /api/player/playback (queued plays)
    Admin->>UI: Device page → proof of play shows the offline hours too
    end
```

## 13.4 Timing budget (typical LAN)

| Step | Typical time | Governed by |
|---|---|---|
| Code appears on a fresh screen | < 2 s after page load | `POST /api/pairing` |
| Screen reacts after admin pairs | ≤ 3 s | pairing poll interval |
| First content visible | download time of the playlist's files + ~1 s | network, file sizes |
| Admin edit reaches screens | < 1 s push + conditional GET + any new downloads | SignalR `ContentChanged` |
| Schedule boundary to switch | ≤ 15 s | evaluation interval |
| Status shows Offline after power loss | 90–120 s | 90 s threshold + 30 s sweep |
| Offline after clean disconnect (network drop detected by the socket) | seconds to ~30 s | SignalR keep-alive |
| Status Online after recovery | ≤ 30 s | reconnect back-off |
