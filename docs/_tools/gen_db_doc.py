#!/usr/bin/env python3
"""
Regenerates docs/03-database.md from the live PostgreSQL catalog, so the ERD never drifts from the schema.
Usage:  PGPASSWORD=... python3 docs/_tools/gen_db_doc.py --host localhost --db signage --user signage
"""
import argparse, subprocess, collections, pathlib

ap = argparse.ArgumentParser()
ap.add_argument("--host", default="localhost"); ap.add_argument("--db", default="signage"); ap.add_argument("--user", default="signage")
ap.add_argument("--out", default=str(pathlib.Path(__file__).resolve().parents[1] / "03-database.md"))
a = ap.parse_args()

def q(sql):
    r = subprocess.run(["psql", "-h", a.host, "-U", a.user, "-d", a.db, "-At", "-F", "\x1f", "-c", sql], capture_output=True, text=True, check=True)
    return [l.split("\x1f") for l in r.stdout.strip().splitlines() if l]

cols = q("""select table_name, column_name, data_type, is_nullable, coalesce(character_maximum_length::text,''), ordinal_position
            from information_schema.columns where table_schema='public' order by table_name, ordinal_position""")
pks = q("""select tc.table_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu
           on tc.constraint_name=kcu.constraint_name and tc.table_name=kcu.table_name where tc.table_schema='public' and tc.constraint_type='PRIMARY KEY'""")
fks = q("""select con.conrelid::regclass::text, a.attname, con.confrelid::regclass::text, fa.attname,
           case con.confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'r' then 'RESTRICT' when 'a' then 'NO ACTION' else con.confdeltype::text end, con.conname
           from pg_constraint con join pg_attribute a on a.attrelid=con.conrelid and a.attnum=con.conkey[1]
           join pg_attribute fa on fa.attrelid=con.confrelid and fa.attnum=con.confkey[1]
           where con.contype='f' and con.connamespace='public'::regnamespace order by 1,2""")
idx = q("""select tablename, indexname, indexdef from pg_indexes where schemaname='public' and indexname not like 'PK_%' order by 1,2""")
chk = q("""select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where contype='c' and connamespace='public'::regnamespace""")

strip = lambda s: s.strip('"')
T = collections.OrderedDict()
for t, c, dt, nul, ln, _ in cols: T.setdefault(t, []).append((c, dt, nul == "YES", ln))
PK = collections.defaultdict(set); [PK[t].add(c) for t, c in pks]
FK = collections.defaultdict(dict); FKLIST = []
for t, c, rt, rc, rule, name in fks:
    t, rt = strip(t), strip(rt); FK[t][c] = (rt, rc, rule); FKLIST.append((t, c, rt, rc, rule, name))
UNIQ = collections.defaultdict(list); IDX = collections.defaultdict(list)
for t, n, d in idx:
    colsin = d[d.index("(") + 1:d.rindex(")")].replace('"', "")
    (UNIQ if " UNIQUE " in d else IDX)[t].append((n, colsin))
UNIQCOLS = collections.defaultdict(set)
for t, lst in UNIQ.items():
    for n, cs in lst:
        if "," not in cs: UNIQCOLS[t].add(cs.strip())

TYPE = {"uuid": "uuid", "text": "text", "character varying": "varchar", "integer": "int", "bigint": "bigint", "boolean": "bool",
        "timestamp with time zone": "timestamptz", "date": "date", "time without time zone": "time", "double precision": "float8", "numeric": "numeric"}

DOMAINS = collections.OrderedDict([
    ("Tenancy and billing", ["Organizations", "Subscriptions", "Locations"]),
    ("Identity and access", ["Organizations", "Users", "Roles", "Permissions", "RolePermissions", "UserRoles", "RefreshTokens"]),
    ("Screens", ["Organizations", "Locations", "Devices", "DeviceGroups", "DeviceGroupMembers", "PairingRequests", "PlaybackLogs", "Playlists"]),
    ("Content and scheduling", ["MediaAssets", "Playlists", "PlaylistItems", "Layouts", "LayoutZones", "Schedules", "ScheduleTargets", "Devices", "DeviceGroups"]),
    ("Activity", ["Organizations", "Notifications", "AuditLogs"]),
])
# Relationships the application maintains without a database FK (kept soft on purpose; see "Soft references").
SOFT = [("PairingRequests", "OrganizationId", "Organizations"), ("PairingRequests", "DeviceId", "Devices"),
        ("PlaybackLogs", "MediaAssetId", "MediaAssets"), ("PlaybackLogs", "PlaylistId", "Playlists"), ("PlaybackLogs", "OrganizationId", "Organizations"),
        ("AuditLogs", "UserId", "Users"), ("Notifications", "UserId", "Users"), ("MediaAssets", "UploadedById", "Users")]

def erd(tables, detail=True, keys_only=False):
    out = ["erDiagram"]
    shown = set(tables)
    for t in tables:
        if not detail: out.append(f"    {t} {{\n        uuid Id PK\n    }}"); continue
        out.append(f"    {t} {{")
        for c, dt, nul, ln in T[t]:
            keys = [k for k, on in (("PK", c in PK[t]), ("FK", c in FK[t]), ("UK", c in UNIQCOLS[t])) if on]
            soft = any(st == t and sc == c for st, sc, _ in SOFT)
            if keys_only and not keys and not soft: continue
            note = "nullable" if nul else ""
            line = f"        {TYPE.get(dt, dt.split()[0])} {c}" + (f" {','.join(keys)}" if keys else "") + (f' "{note}"' if note else "")
            out.append(line)
        out.append("    }")
    for t, c, rt, rc, rule, _ in FKLIST:
        if t in shown and rt in shown:
            nullable = any(col == c and n for col, _, n, _ in T[t])
            one_to_one = c in UNIQCOLS[t]
            left = "|o" if nullable else "||"
            right = "o|" if one_to_one else "o{"
            out.append(f'    {rt} {left}--{right} {t} : "{c} ({rule.lower()})"')
    for t, c, rt in SOFT:
        if t in shown and rt in shown: out.append(f'    {rt} |o..o{{ {t} : "{c} (soft, no FK)"')
    return "\n".join(out)

md = []
w = md.append
w("# 3. Database\n")
w("> Generated from the live PostgreSQL catalog by `docs/_tools/gen_db_doc.py`. Re-run it after any schema change; don't edit this file by hand.\n")
w(f"PostgreSQL 16 · EF Core 8 (Npgsql 8) · **{len(T)} tables**, **{len(FKLIST)} foreign keys**, **{sum(len(v) for v in UNIQ.values())} unique indexes**, **{len(chk)} check constraints**.\n")
w("## 3.1 Conventions\n")
w("""| Convention | Detail |
|---|---|
| Primary keys | `uuid`, generated in the application (`Guid.NewGuid()`), configured `ValueGeneratedNever`. Join tables use composite keys. `Permissions` is keyed by its code. |
| Tenancy | Every tenant-owned table has `OrganizationId` (indexed). EF global query filters add `WHERE "OrganizationId" = @currentOrg` to every query, and join tables are filtered through their parent. See [§3.6](#36-multi-tenancy-enforcement). |
| Enums | Stored as `text` (e.g. `Devices.Type = 'AndroidTv'`), so adding a device type needs no data migration. |
| Timestamps | `timestamp with time zone`, always UTC. `CreatedAt` and `UpdatedAt` are set in `AppDbContext.SaveChangesAsync`. |
| Secrets | Never stored in plain text: passwords are PBKDF2 hashes (ASP.NET Identity v3 format); refresh tokens, device keys and pairing poll secrets are SHA-256 hashes. |
| Naming | Tables are plural PascalCase. Constraint names follow EF conventions (`PK_`, `FK_<Child>_<Parent>_<Column>`, `IX_`, `CK_`). |
""")
w("## 3.2 Domain overview\n")
w("```mermaid\nflowchart LR\n" + "\n".join([
 "    subgraph Tenancy[Tenancy and billing]\n        ORG[Organizations] --- SUB[Subscriptions]\n        ORG --- LOC[Locations]\n    end",
 "    subgraph Identity[Identity and access]\n        USR[Users] --- UR[UserRoles] --- ROL[Roles] --- RP[RolePermissions] --- PERM[Permissions]\n        USR --- RT[RefreshTokens]\n    end",
 "    subgraph Screens\n        DEV[Devices] --- DGM[DeviceGroupMembers] --- DG[DeviceGroups]\n        PR[PairingRequests] -.-> DEV\n        DEV --- PL[PlaybackLogs]\n    end",
 "    subgraph Content[Content and scheduling]\n        MA[MediaAssets] --- PI[PlaylistItems] --- P[Playlists]\n        LAY[Layouts] --- LZ[LayoutZones] --- P\n        SCH[Schedules] --- ST[ScheduleTargets]\n        SCH --- LAY\n        SCH --- P\n    end",
 "    subgraph Activity\n        NOT[Notifications]\n        AUD[AuditLogs]\n    end",
 "    ORG --- USR\n    ORG --- ROL\n    ORG --- DEV\n    LOC --- DEV\n    ORG --- MA\n    ST --- DEV\n    ST --- DG\n    DEV -. default playlist .- P\n    DG -. default playlist .- P\n    ORG --- NOT\n    ORG --- AUD"]) + "\n```\n")
w("## 3.3 Complete ERD\n")
w("Crow's-foot notation: `||` exactly one, `|o` zero or one, `o{` zero or many. Each relationship is labelled with the FK column and its `ON DELETE` rule. Dotted lines are soft references with no database FK.\n")
w("For readability this map shows **key columns only** (PK, FK, UK and soft-reference columns). Every column appears in the per-domain ERDs below and in the [table reference](#34-table-reference).\n")
w("```mermaid\n" + erd(list(T.keys()), keys_only=True) + "\n```\n")
w("### ERDs by domain\n")
for name, tables in DOMAINS.items():
    w(f"#### {name}\n\n```mermaid\n" + erd([t for t in tables if t in T]) + "\n```\n")

w("## 3.4 Table reference\n")
for t, columns in T.items():
    w(f"### {t}\n")
    w("| Column | Type | Null | Key | References |\n|---|---|---|---|---|")
    for c, dt, nul, ln in columns:
        keys = " ".join(k for k, on in (("PK", c in PK[t]), ("FK", c in FK[t]), ("UNIQUE", c in UNIQCOLS[t])) if on)
        ref = f"`{FK[t][c][0]}.{FK[t][c][1]}` · on delete **{FK[t][c][2]}**" if c in FK[t] else next((f"`{rt}` (soft)" for st, sc, rt in SOFT if st == t and sc == c), "")
        typ = TYPE.get(dt, dt) + (f"({ln})" if ln else "")
        w(f"| `{c}` | {typ} | {'yes' if nul else 'no'} | {keys} | {ref} |")
    extra = [f"UNIQUE `{n}` ({cs})" for n, cs in UNIQ.get(t, [])] + [f"INDEX `{n}` ({cs})" for n, cs in IDX.get(t, [])]
    extra += [f"CHECK `{n}`: `{d}`" for ct, n, d in chk if strip(ct) == t]
    if extra: w("\n" + "  \n".join(f"- {e}" for e in extra))
    w("")

w("## 3.5 Constraints and delete behaviour\n")
w("| Child.column | Parent | On delete | Why |\n|---|---|---|---|")
WHY = {"CASCADE": "Owned data goes with its parent.", "SET NULL": "Optional link; the child survives.", "RESTRICT": "Blocked in the database; the service returns 409 first with a readable message."}
for t, c, rt, rc, rule, _ in FKLIST: w(f"| `{t}.{c}` | `{rt}` | {rule} | {WHY.get(rule, '')} |")
w("\n**Check constraints**\n")
for ct, n, d in chk: w(f"- `{strip(ct)}.{n}`: `{d}`")
w("""
Application-level invariants (enforced in services, returned as 400/402/409):
- A schedule targets at least one device or group; exactly one of layout or playlist (also a DB check); `DaysOfWeek` is a bitmask 1..127 (bit 0 = Sunday); `Priority` is 0..100; `StartTime`/`EndTime` are both set or both null and never equal (start > end means an overnight window).
- Layout zones: 1–12 per layout, each inside 0–100 % of the canvas; resolution 320×240 to 7680×7680.
- Playlists hold at most 500 items; item durations are 1 s to 24 h; transitions are `none`, `fade` or `slide`.
- Plan limits (`Subscriptions.MaxDevices / MaxUsers / MaxStorageBytes`) are checked before pairing, adding users and uploading (HTTP 402).
- An organization always keeps at least one active Owner; built-in roles (`IsSystem`) and templates (`IsTemplate`) are read-only.
- Pairing codes are unique among `Pending` requests, valid for 15 minutes, and use the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I).
""")
w("## 3.6 Multi-tenancy enforcement\n")
w("""```mermaid
flowchart TD
    R[HTTP / SignalR request] --> A{Authenticated?}
    A -- JWT --> C1[org claim from token]
    A -- Device key --> C2[org claim from Devices row]
    A -- anonymous --> C3[no org: filters match nothing]
    C1 & C2 & C3 --> F[AppDbContext.CurrentOrganizationId]
    F --> Q["Global query filter on every ITenantEntity:<br/>WHERE OrganizationId = CurrentOrganizationId"]
    F --> J["Join tables filtered via parent:<br/>PlaylistItems via Playlist, LayoutZones via Layout, ..."]
    F --> S{SaveChangesAsync}
    S -- Added with empty OrganizationId --> ST[stamp current org]
    S -- "row.OrganizationId != current org" --> X[throw: cross-tenant write blocked]
```
Only these code paths use `IgnoreQueryFilters()`, each intentionally: login and registration (email lookup across tenants), refresh-token lookup, device-key authentication, signed file download (the HMAC signature is the authorization), and the background offline sweep across all tenants.
""")
w("## 3.7 Enumerations (stored as text)\n")
w("""| Enum | Values | Columns |
|---|---|---|
| DeviceType | `AndroidTv`, `AndroidTablet`, `WebPlayer`, `Other` | `Devices.Type`, `PairingRequests.DeviceType` |
| DeviceStatus | `Offline`, `Online` | `Devices.Status` |
| Orientation | `Landscape`, `Portrait` | `Devices.Orientation`, `Layouts.Orientation` |
| MediaType | `Image`, `Video`, `Web` | `MediaAssets.Type` |
| PairingStatus | `Pending`, `Paired`, `Expired` | `PairingRequests.Status` |
| SubscriptionPlan | `Free` (3 devices / 3 users / 2 GB), `Pro` (100 / 25 / 100 GB), `Enterprise` (10 000 / 1 000 / 2 000 GB) | `Subscriptions.Plan` |
| SubscriptionStatus | `Active`, `PastDue`, `Cancelled` | `Subscriptions.Status` |
| NotificationSeverity | `Info`, `Success`, `Warning`, `Error` | `Notifications.Severity` |
""")
w("""## 3.8 Soft references

These columns point at other rows but deliberately have **no** foreign key, because the record must outlive its target or exists before the target does:

| Column | Points to | Reason |
|---|---|---|
""" + "\n".join(f"| `{t}.{c}` | `{rt}` | " + {
 ("PairingRequests","OrganizationId"):"Set only when claimed; a request exists before any organization is known.",
 ("PairingRequests","DeviceId"):"Set when claimed; the pairing record is kept as history after the device is removed.",
 ("PlaybackLogs","MediaAssetId"):"Proof-of-play must survive media deletion (reported as “(deleted)”).",
 ("PlaybackLogs","PlaylistId"):"Same as above.",
 ("PlaybackLogs","OrganizationId"):"Denormalised for tenant filtering and reporting; the device FK cascades.",
 ("AuditLogs","UserId"):"The audit trail must survive user deletion; `UserEmail` is copied onto the row.",
 ("Notifications","UserId"):"Null means organization-wide.",
 ("MediaAssets","UploadedById"):"Media survives its uploader.",
}[(t,c)] + " |" for t, c, rt in SOFT) + "\n")
w("""## 3.9 Data growth and retention

| Table | Growth | Recommendation |
|---|---|---|
| `PlaybackLogs` | one row per item played per screen (~8,640 per screen per day with 10 s items) | Partition by month, or roll up into daily aggregates and delete raw rows after 90 days. |
| `AuditLogs` | one row per admin change | Keep 1–7 years depending on compliance needs; index `(OrganizationId, CreatedAt)` already exists. |
| `Notifications` | device on/offline events | Delete read notifications older than 30 days. |
| `RefreshTokens` | one per sign-in or refresh | Delete rows where `ExpiresAt < now() - 1 day`. |
| `PairingRequests` | one per code shown | Delete non-pending rows older than 7 days. |

No retention jobs exist yet; see [Deployment §9.8](09-deployment.md#98-operations) for SQL you can schedule.
""")
pathlib.Path(a.out).write_text("\n".join(md))
print(f"wrote {a.out}: {len(T)} tables, {len(FKLIST)} FKs")
