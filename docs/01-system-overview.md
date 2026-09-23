# 1. System overview

## 1.1 Purpose

Signage CMS lets an organization run digital screens (Android TVs, Android tablets, and any browser) from one web console. Admins upload media, arrange it into playlists and multi-zone layouts, schedule what plays where and when, and watch every screen's status live. Screens keep playing, and keep following their schedules, when the network is down.

It is **multi-tenant**: every customer organization is isolated, with its own users, roles, locations, screens, content and plan limits.

## 1.2 Capabilities

| Area | Capabilities |
|---|---|
| Organizations | Self-service signup, organization settings, default time zone, Free/Pro/Enterprise plan limits and usage |
| People | Users, 4 built-in roles (Owner, Admin, Editor, Viewer), custom roles over 23 permissions, audit log |
| Screens | Locations with time zones, device groups, code-based pairing, live online/offline status, remote commands (identify, sync, restart, clear cache), proof-of-play reports |
| Content | Media library (images, video, web pages; 1 GB uploads; sha256), playlists (durations, transitions, shuffle), layouts with up to 12 zones and 6 templates, schedules (date range, days of week, time windows incl. overnight, priority, device and group targets) |
| Delivery | Offline manifest with content hashing and ETags, verified local media cache, on-device scheduling in the screen's time zone, SignalR push, heartbeats every 30 s |
| Players | Android app (one APK for TV and tablet, kiosk, boot start), web player for any browser, an open device protocol for new device types |
| Operations | Notifications, Swagger, health endpoint, Docker files, single-process deployment |

## 1.3 Glossary

| Term | Meaning |
|---|---|
| Organization (tenant) | A customer account. All data is scoped to one |
| Location | A physical site with a time zone. Screens at a location follow its local time |
| Device / screen | A paired player. Types: `AndroidTv`, `AndroidTablet`, `WebPlayer`, `Other` |
| Device group | A named set of devices; schedules and default playlists can target groups |
| Pairing code | 6 characters shown on an unpaired screen; valid for 15 minutes |
| Device key | 256-bit secret issued to a screen once at pairing; its only credential |
| Media asset | An image, video or web page. Files carry a sha256 checksum |
| Playlist | An ordered list of media with per-item duration and transition |
| Layout / zone | A screen split into rectangles (in % of the screen); each zone plays a playlist |
| Template | A read-only starter layout, copied into a real layout |
| Schedule | Rules for when a playlist or layout plays on which devices or groups; highest priority wins |
| Default playlist | What a screen plays when no schedule applies (device first, then group) |
| Manifest | The JSON a screen downloads describing everything it may need offline; versioned by content hash |
| Proof-of-play | Records of what actually played, uploaded by screens |
| Heartbeat | A status report from a screen every 30 s; silence for 90 s means Offline |

## 1.4 Repository structure

```text
signage-cms/
├── README.md                     # quick start
├── docker-compose.yml            # db + api
├── backend/                      # .NET 8 solution (Domain, Application, Infrastructure, Api) + Dockerfile
├── frontend/                     # React admin console + web player (Vite, TS, Tailwind, shadcn/ui)
├── android/                      # Signage Player app (Java, no Gradle), build.sh, keystore/
├── tests/                        # e2e.mjs, browser_e2e.py, lan_player_test.py, race_test.mjs
├── scripts/dev-api.sh            # dev: (re)start API in background
└── docs/                         # this documentation set
    ├── api/openapi.json          # generated OpenAPI 3 spec
    ├── api/samples.json          # real captured responses
    └── _tools/                   # doc generators and Mermaid validator
```

## 1.5 Quick start (5 minutes)

```bash
# PostgreSQL: user signage / signage_dev_pw, database signage
cd backend/src/SignageCms.Api && dotnet run            # API + seed → http://localhost:5080
cd frontend && npm install && npm run build:api        # UI into the API → reload :5080
# sign in: admin@demo.local / Admin@12345
# open http://localhost:5080/player in another window → pair its code under Devices
```

## 1.6 Current status and known limitations

Verified in this codebase: 81 API/SignalR checks, 19 browser checks, 8 LAN-player checks, and a race test, all passing; zero server errors logged across runs. See [Testing](10-testing.md).

Known limitations, each with a documented path forward:
- Schema created with `EnsureCreated()`; adopt EF migrations before production ([§9.4](09-deployment.md#94-database-migrations)).
- Single-node assumptions: local media storage and no SignalR backplane ([§2.8](02-architecture.md#28-deployment-topology-and-scaling)).
- Security findings S1–S13, three rated High ([§11.3](11-security.md#113-findings-and-recommended-fixes)).
- Android app targets API 23 (sideload/MDM; Play needs a Gradle port) and hasn't been run on physical hardware in the build environment ([§8.2](08-players.md#82-build-commands-apk), [§10.5](10-testing.md#105-manual-acceptance-checklist-real-hardware)).
- Docker files and the CI example weren't executed in the build environment ([§9.5](09-deployment.md#95-docker)).
- Not built yet: payment integration, email flows (invite, reset, verify), MFA, media transcoding and thumbnails, per-user notification read state, retention jobs.
