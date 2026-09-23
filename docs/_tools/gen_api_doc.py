#!/usr/bin/env python3
"""
Builds docs/05-api-reference.md from: the controllers (routes + permissions), docs/api/openapi.json (schemas),
and docs/api/samples.json (real responses captured from a running instance).
Refresh:  curl -s http://localhost:5080/swagger/v1/swagger.json > docs/api/openapi.json && python3 docs/_tools/gen_api_doc.py
"""
import json, re, glob, pathlib, collections
ROOT = pathlib.Path(__file__).resolve().parents[2]; DOCS = ROOT / "docs"
spec = json.loads((DOCS / "api/openapi.json").read_text()); S = json.loads((DOCS / "api/samples.json").read_text())
perm_src = (ROOT / "backend/src/SignageCms.Application/Common/Permissions.cs").read_text()
PERM = dict(re.findall(r'public const string (\w+) = "([^"]+)";', perm_src))

routes = []
for f in sorted(glob.glob(str(ROOT / "backend/src/SignageCms.Api/Controllers/*.cs"))):
    src = pathlib.Path(f).read_text()
    for cls in re.finditer(r'\[ApiController, Route\("([^"]+)"\)([^\]]*)\]\s*public class (\w+)(.*?)(?=\n\[ApiController|\Z)', src, re.S):
        base, clsattr, name, body = cls.groups()
        for m in re.finditer(r'\[(Http(Get|Post|Put|Delete))(?:\("([^"]*)"\))?([^\]]*)\]\s*public [^(]*?(\w+)\(', body):
            verb, sub, attrs, action = m.group(2).upper(), m.group(3), m.group(4) + " " + clsattr, m.group(5)
            path = sub if sub and sub.startswith("/") else base.rstrip("/") + ("/" + sub if sub else "")
            path = "/" + path.lstrip("/")
            p = re.search(r'HasPermission\(Permissions\.(\w+)\)', attrs)
            auth = f"`{PERM[p.group(1)]}`" if p else ("anonymous" if "AllowAnonymous" in attrs else ("Device key" if "DeviceAuthenticationHandler" in clsattr else "any signed-in user"))
            rl = "auth" if 'EnableRateLimiting("auth")' in clsattr else ("pairing" if 'EnableRateLimiting("pairing")' in clsattr else "")
            routes.append(dict(ctrl=name, verb=verb, path=path, auth=auth, action=action, rl=rl))

def ref(schema):
    if not schema: return ""
    if "$ref" in schema: return schema["$ref"].split("/")[-1]
    if schema.get("type") == "array": return ref(schema.get("items", {})) + "[]"
    return schema.get("type", "object")

def op_for(r):
    oa = re.sub(r"\{(\w+):\w+\}", r"{\1}", r["path"])
    return spec["paths"].get(oa, {}).get(r["verb"].lower(), {}), oa

def fields(name):
    sch = spec["components"]["schemas"].get(name, {})
    req = set(sch.get("required", []))
    rows = []
    for k, v in sch.get("properties", {}).items():
        t = ref(v) if ("$ref" in v or v.get("type") == "array") else v.get("type", "object") + (f" ({v['format']})" if v.get("format") else "")
        rows.append(f"| `{k}` | {t}{' · nullable' if v.get('nullable') else ''} |")
    return rows

GROUPS = collections.OrderedDict([
    ("5.3 Authentication", ["AuthController"]),
    ("5.4 Users and roles", ["UsersController", "RolesController"]),
    ("5.5 Organization, subscription and dashboard", ["OrganizationController"]),
    ("5.6 Locations", ["LocationsController"]),
    ("5.7 Devices and pairing (admin side)", ["DevicesController"]),
    ("5.8 Device groups", ["DeviceGroupsController"]),
    ("5.9 Media and files", ["MediaController", "FilesController"]),
    ("5.10 Playlists and layouts", ["PlaylistsController", "LayoutsController"]),
    ("5.11 Schedules", ["SchedulesController"]),
    ("5.12 Player (device API)", ["PairingController", "PlayerController"]),
    ("5.13 Notifications and audit log", ["NotificationsController", "AuditLogsController"]),
])
EX = {  # real captured examples, keyed by "VERB path"
    "POST /api/auth/login": ("Response 200", {k: (v[:40] + "…" if isinstance(v, str) and len(v) > 44 else v) for k, v in S["login"].items() if k != "user"} | {"user": {**S["login"]["user"], "permissions": S["login"]["user"]["permissions"][:4] + ["…"]}}),
    "POST /api/pairing": ("Response 200", S["pair_create"]),
    "GET /api/pairing/{id:guid}": ("Responses 200 (pending, then paired)", [S["pair_status_pending"], {**S["pair_status_paired"], "deviceKey": S["pair_status_paired"]["deviceKey"][:12] + "…"}]),
    "POST /api/devices/pair": ("Response 200", S["device"]),
    "POST /api/schedules": ("Response 200", S["schedule"]),
    "GET /api/player/manifest": ("Response 200 (ETag " + S["manifest_etag"] + ")", S["manifest"]),
    "GET /api/media": ("Response 200", S["media"]),
    "GET /api/playlists/{id:guid}": ("Response 200", S["playlist"]),
    "GET /api/dashboard": ("Response 200 (trimmed)", {**S["dashboard"], "recentActivity": S["dashboard"]["recentActivity"][:1], "devices": S["dashboard"]["devices"][:1]}),
    "GET /api/subscription": ("Response 200", S["subscription"]),
}
NOTES = {
    "POST /api/auth/refresh": "Rotates the refresh token. Reusing a rotated token returns 401 **and revokes every active session of the user**.",
    "POST /api/auth/logout": "Revokes the given refresh token. Always 204.",
    "DELETE /api/users/{id:guid}": "Can't delete yourself; the organization must keep at least one active Owner.",
    "PUT /api/users/{id:guid}": "Deactivating a user or setting `newPassword` revokes all their refresh tokens.",
    "PUT /api/roles/{id:guid}": "Built-in roles (`isSystem`) return 403.",
    "DELETE /api/roles/{id:guid}": "409 while any user still has the role.",
    "PUT /api/subscription": "402 if current usage exceeds the target plan. No payment is collected (see Security §11.9).",
    "GET /api/timezones": "IANA ids (`Region/City` plus `UTC`) from the server OS.",
    "POST /api/devices/pair": "400 if the code is unknown or expired, 402 at the plan's device limit.",
    "DELETE /api/devices/{id:guid}": "Revokes the key immediately and pushes `Revoked` to the screen.",
    "POST /api/devices/{id:guid}/commands": "Body `{ \"command\": \"identify\" | \"refresh\" | \"reload\" | \"clear-cache\" }` → 202. Delivered only if the screen is connected.",
    "GET /api/devices/{id:guid}/playback": "Query `days` (1–90, default 7). Plays and seconds per media item.",
    "POST /api/media": "`multipart/form-data`: `file` (required), `name`, `width`, `height`, `durationSeconds`, `tags`. Max 1 GB. Types: jpg, jpeg, png, gif, webp, mp4, webm, m4v. 402 when over the storage quota.",
    "DELETE /api/media/{id:guid}": "409 if any playlist uses it (names the playlists).",
    "GET /api/files/{id:guid}": "**Anonymous**: the HMAC signature is the authorization. Query `exp` (unix seconds) and `sig`. Supports `Range` (206). 403 if expired or tampered. Signed URLs come from media and manifest responses; never build them yourself.",
    "PUT /api/playlists/{id:guid}": "Replaces all items. Triggers `ContentChanged` to the organization's screens.",
    "DELETE /api/playlists/{id:guid}": "409 while any schedule uses it; device, group and zone defaults become null.",
    "PUT /api/layouts/{id:guid}": "Templates return 403. Zones must fit 0–100 %. Triggers `ContentChanged`.",
    "DELETE /api/layouts/{id:guid}": "409 while any schedule uses it; templates return 403.",
    "GET /api/audit-logs": "Query `page`, `pageSize` (≤200), `entityType`, `search` (summary, user or action).",
    "GET /api/notifications": "Query `unreadOnly`, `take` (≤200). Returns `{ items, unreadCount }`.",
    "GET /api/devices": "Query `locationId`, `groupId`, `status` (Online/Offline).",
    "GET /api/media": "Query `search` (name or tags), `type` (Image/Video/Web).",
    "POST /api/pairing": "Rate limit 60/min/IP. Code valid 15 min, poll every `pollIntervalSeconds`.",
    "GET /api/pairing/{id:guid}": "Header `X-Poll-Secret` (required). The `deviceKey` is returned exactly once. Wrong secret → 404.",
    "GET /api/player/manifest": "Send `If-None-Match` with the last ETag → 304 when unchanged. Also records `LastSyncAt`. Media URLs are signed for 7 days.",
    "POST /api/player/heartbeat": "Same payload as the SignalR `Heartbeat` method. Marks the device Online. 204.",
    "POST /api/player/playback": "Array of `{ mediaId, playlistId, playedAt (UTC), durationSeconds }`, max 1000 per call; entries older than 30 days or >5 min in the future are dropped. 204.",
}
out = []; w = out.append
w((DOCS / "_tools/api_intro.md").read_text())
for title, ctrls in GROUPS.items():
    rs = [r for r in routes if r["ctrl"] in ctrls]
    w(f"## {title}\n")
    w("| Method | Path | Auth / permission | Request body | Response |\n|---|---|---|---|---|")
    for r in rs:
        op, _ = op_for(r)
        body = ref(op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")) or ("multipart" if "multipart/form-data" in json.dumps(op.get("requestBody", {})) else "")
        resp = ""
        for code, rv in op.get("responses", {}).items():
            resp = ref(rv.get("content", {}).get("application/json", {}).get("schema")) if rv.get("content") else code
        resp = {"POST /api/player/heartbeat": "204", "POST /api/player/playback": "204", "GET /api/player/manifest": "DeviceManifest · 304", "GET /api/files/{id:guid}": "file bytes · 206 · 403",
                "POST /api/devices/{id:guid}/commands": "202"}.get(f"{r['verb']} {r['path']}", resp)
        if r["verb"] == "DELETE" or r["path"].endswith("/logout") or r["path"].endswith("/read"): resp = "204"
        rl = f" · rate limit `{r['rl']}`" if r["rl"] else ""
        w(f"| `{r['verb']}` | `{r['path']}` | {r['auth']}{rl} | {('`'+body+'`') if body else '—'} | {('`'+resp+'`') if resp else '—'} |")
    w("")
    for r in rs:
        k = f"{r['verb']} {r['path']}"
        if k in NOTES or k in EX:
            w(f"**`{k}`**. " + NOTES.get(k, ""))
            if k in EX:
                label, data = EX[k]
                w(f"\n<details><summary>{label}</summary>\n\n```json\n{json.dumps(data, indent=2)}\n```\n</details>\n")
            w("")
    used = set()
    for r in rs:
        op, _ = op_for(r)
        b = ref(op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema", {}))
        if b and not b.endswith("[]") and b in spec["components"]["schemas"]: used.add(b)
    for b in sorted(used):
        rows = fields(b)
        if rows: w(f"<details><summary><code>{b}</code> fields</summary>\n\n| Field | Type |\n|---|---|\n" + "\n".join(rows) + "\n</details>\n")
w((DOCS / "_tools/api_outro.md").read_text())
(DOCS / "05-api-reference.md").write_text("\n".join(out))
print(f"{len(routes)} routes documented in {len(GROUPS)} groups")
