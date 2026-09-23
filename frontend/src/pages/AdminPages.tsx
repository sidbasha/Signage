import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, Check, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AuditLog, Notification, Organization, Paged, Permission, Role, Subscription, User } from "@/lib/types";
import { cn, formatBytes, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Checkbox, Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmButton, EmptyState, Field, FormError, Loading, PageHeader, QueryError, fieldError, useAction } from "@/components/common";
import { useTimeZones } from "./GroupsLocationsPages";

// ---------------------------------------------------------------- Users
export function UsersPage() {
  const { can, user: me } = useAuth();
  const q = useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/api/users") });
  const [edit, setEdit] = useState<Partial<User> | null>(null);
  const del = useAction((id: string) => api(`/api/users/${id}`, { method: "DELETE" }), { invalidate: [["users"]], success: "User removed" });
  return (
    <>
      <PageHeader title="Users" description="People who can sign in to manage your screens." actions={can("users.manage") && <Button onClick={() => setEdit({})}><Plus />Add user</Button>} />
      {q.isLoading ? <Loading /> : q.error ? <QueryError error={q.error} /> : (
        <Table><THead><TR><TH>Name</TH><TH>Roles</TH><TH>Status</TH><TH>Last sign-in</TH><TH className="w-24" /></TR></THead>
          <TBody>{q.data!.map(u => (
            <TR key={u.id}><TD><div className="font-medium">{u.fullName}{u.id === me?.id && <span className="ml-2 text-xs text-muted-foreground">you</span>}</div><div className="text-xs text-muted-foreground">{u.email}</div></TD>
              <TD><div className="flex flex-wrap gap-1">{u.roles.map(r => <Badge key={r.id} variant="secondary">{r.name}</Badge>)}</div></TD>
              <TD>{u.isActive ? <Badge>Active</Badge> : <Badge variant="destructive">Deactivated</Badge>}</TD>
              <TD>{timeAgo(u.lastLoginAt)}</TD>
              <TD className="text-right">{can("users.manage") && <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" aria-label={`Edit ${u.fullName}`} onClick={() => setEdit(u)}><Pencil /></Button>
                {u.id !== me?.id && <ConfirmButton title={`Remove ${u.fullName}?`} description="They lose access immediately. Their audit history is kept." confirmLabel="Remove user" onConfirm={() => del.mutateAsync(u.id)}>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${u.fullName}`}><Trash2 /></Button></ConfirmButton>}</div>}</TD></TR>))}
          </TBody></Table>
      )}
      {edit && <UserDialog value={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function UserDialog({ value, onClose }: { value: Partial<User>; onClose: () => void }) {
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/api/roles") }).data ?? [];
  const [f, setF] = useState({ email: value.email ?? "", fullName: value.fullName ?? "", password: "", isActive: value.isActive ?? true, roleIds: value.roles?.map(r => r.id) ?? [] });
  useEffect(() => { if (!value.id && roles.length && !f.roleIds.length) setF(x => ({ ...x, roleIds: [roles.find(r => r.name === "Editor")?.id ?? roles[0].id] })); }, [roles, value.id, f.roleIds.length]);
  const save = useAction(() => value.id
    ? api(`/api/users/${value.id}`, { method: "PUT", json: { fullName: f.fullName, isActive: f.isActive, roleIds: f.roleIds, newPassword: f.password || null } })
    : api("/api/users", { method: "POST", json: { email: f.email, fullName: f.fullName, password: f.password, roleIds: f.roleIds } }),
    { invalidate: [["users"], ["roles"]], success: value.id ? "User saved" : "User added. Share their password with them securely.", onSuccess: onClose });
  const e = save.error;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{value.id ? `Edit ${value.fullName}` : "Add user"}</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={ev => { ev.preventDefault(); save.mutate(undefined); }}>
          {!value.id && <Field label="Email" error={fieldError(e, "email")}><Input type="email" required autoFocus value={f.email} onChange={x => setF({ ...f, email: x.target.value })} /></Field>}
          <Field label="Full name" error={fieldError(e, "fullName")}><Input required value={f.fullName} onChange={x => setF({ ...f, fullName: x.target.value })} /></Field>
          <Field label={value.id ? "New password" : "Temporary password"} error={fieldError(e, "password")} hint={value.id ? "Leave empty to keep the current password. Changing it signs them out everywhere." : "At least 8 characters with a letter and a number."}>
            <Input type="password" autoComplete="new-password" required={!value.id} value={f.password} onChange={x => setF({ ...f, password: x.target.value })} /></Field>
          <Field label="Roles" error={fieldError(e, "roleIds")}><div className="grid gap-2">{roles.map(r => (
            <label key={r.id} className="flex items-start gap-2 text-sm"><Checkbox className="mt-0.5" checked={f.roleIds.includes(r.id)} onCheckedChange={c => setF({ ...f, roleIds: c ? [...f.roleIds, r.id] : f.roleIds.filter(x => x !== r.id) })} />
              <span><span className="font-medium">{r.name}</span>{r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}</span></label>))}</div></Field>
          {value.id && <label className="flex items-center gap-2 text-sm"><Switch checked={f.isActive} onCheckedChange={v => setF({ ...f, isActive: v })} />Active {fieldError(e, "isActive") && <span className="text-xs text-destructive">{fieldError(e, "isActive")}</span>}</label>}
          {e && !["email", "fullName", "password", "roleIds", "isActive"].some(k => fieldError(e, k)) ? <FormError error={e} /> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Roles
export function RolesPage() {
  const { can } = useAuth();
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/api/roles") });
  const perms = useQuery({ queryKey: ["permissions"], queryFn: () => api<Permission[]>("/api/permissions") }).data ?? [];
  const [edit, setEdit] = useState<Partial<Role> | null>(null);
  const del = useAction((id: string) => api(`/api/roles/${id}`, { method: "DELETE" }), { invalidate: [["roles"]], success: "Role deleted" });
  return (
    <>
      <PageHeader title="Roles" description="Built-in roles cover most teams. Create custom roles for anything more specific."
        actions={can("roles.manage") && <Button onClick={() => setEdit({ permissions: [] })}><Plus />New role</Button>} />
      {roles.isLoading ? <Loading /> : roles.error ? <QueryError error={roles.error} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {roles.data!.map(r => (
            <Card key={r.id}>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div><CardTitle className="flex items-center gap-2">{r.name}{r.isSystem && <Badge variant="secondary"><Shield className="h-3 w-3" />Built-in</Badge>}</CardTitle>
                  <CardDescription>{r.description ?? "Custom role"} · {r.userCount} user{r.userCount === 1 ? "" : "s"}</CardDescription></div>
                {can("roles.manage") && !r.isSystem && <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => setEdit(r)}><Pencil /></Button>
                  <ConfirmButton title={`Delete ${r.name}?`} description="Roles still assigned to users can't be deleted." confirmLabel="Delete" onConfirm={() => del.mutateAsync(r.id)}>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`}><Trash2 /></Button></ConfirmButton></div>}
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1">{r.permissions.length === perms.length ? <Badge>All permissions</Badge> : r.permissions.map(p => <Badge key={p} variant="outline" className="font-mono text-[11px]">{p}</Badge>)}</CardContent>
            </Card>
          ))}
        </div>
      )}
      {edit && <RoleDialog value={edit} perms={perms} onClose={() => setEdit(null)} />}
    </>
  );
}

function RoleDialog({ value, perms, onClose }: { value: Partial<Role>; perms: Permission[]; onClose: () => void }) {
  const [f, setF] = useState({ name: value.name ?? "", description: value.description ?? "", permissions: value.permissions ?? [] });
  const save = useAction(() => api(value.id ? `/api/roles/${value.id}` : "/api/roles", { method: value.id ? "PUT" : "POST", json: f }), { invalidate: [["roles"]], success: "Role saved", onSuccess: onClose });
  const groups = [...new Set(perms.map(p => p.group))];
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{value.id ? `Edit ${value.name}` : "New role"}</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={ev => { ev.preventDefault(); save.mutate(undefined); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={fieldError(save.error, "name")}><Input autoFocus required value={f.name} onChange={x => setF({ ...f, name: x.target.value })} /></Field>
            <Field label="Description"><Input value={f.description} onChange={x => setF({ ...f, description: x.target.value })} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">{groups.map(g => (
            <fieldset key={g} className="rounded-md border p-3"><legend className="px-1 text-xs text-muted-foreground">{g}</legend>
              {perms.filter(p => p.group === g).map(p => (
                <label key={p.code} className="flex items-center gap-2 py-1 text-sm"><Checkbox checked={f.permissions.includes(p.code)}
                  onCheckedChange={c => setF({ ...f, permissions: c ? [...f.permissions, p.code] : f.permissions.filter(x => x !== p.code) })} />{p.description}</label>))}
            </fieldset>))}</div>
          {save.error && !fieldError(save.error, "name") ? <FormError error={save.error} /> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending}>Save role</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Audit log
export function AuditPage() {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [entityType, setEntityType] = useState("");
  const q = useQuery({ queryKey: ["audit", page, search, entityType], queryFn: () => api<Paged<AuditLog>>(`/api/audit-logs?${new URLSearchParams({ page: String(page), pageSize: "50", search, entityType })}`), placeholderData: p => p });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (
    <>
      <PageHeader title="Audit log" description="Every change made in your organization, who made it, and from where." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Search summary, user or action" className="w-72" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} aria-label="Search audit log" />
        <NativeSelect className="w-44" value={entityType} onChange={e => { setEntityType(e.target.value); setPage(1); }} aria-label="Entity type">
          <option value="">Everything</option>{["Device", "DeviceGroup", "Location", "MediaAsset", "Playlist", "Layout", "Schedule", "User", "Role", "Subscription", "Organization"].map(t => <option key={t}>{t}</option>)}
        </NativeSelect>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <QueryError error={q.error} /> : (
        <>
          <Table><THead><TR><TH>When</TH><TH>Who</TH><TH>What</TH><TH>Action</TH><TH>IP</TH></TR></THead>
            <TBody>{q.data!.items.map(a => (
              <TR key={a.id}><TD className="whitespace-nowrap text-sm" title={new Date(a.createdAt).toLocaleString()}>{timeAgo(a.createdAt)}</TD><TD className="text-sm">{a.userEmail ?? "system"}</TD>
                <TD className="text-sm">{a.summary}</TD><TD><span className="font-mono text-xs">{a.action}</span></TD><TD className="font-mono text-xs text-muted-foreground">{a.ipAddress}</TD></TR>))}
            </TBody></Table>
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>{q.data!.total} entries</span>
            <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span>Page {page} of {pages}</span><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Notifications
export function NotificationsPage() {
  const q = useQuery({ queryKey: ["notifications", "list"], queryFn: () => api<{ items: Notification[]; unreadCount: number }>("/api/notifications?take=100") });
  const readAll = useAction(() => api("/api/notifications/read-all", { method: "POST" }), { invalidate: [["notifications"]] });
  const read = useAction((id: string) => api(`/api/notifications/${id}/read`, { method: "POST" }), { invalidate: [["notifications"]] });
  const tone = { Success: "bg-primary", Info: "bg-muted-foreground", Warning: "bg-warning", Error: "bg-destructive" } as const;
  return (
    <>
      <PageHeader title="Notifications" description="Screens going offline or coming back, new pairings and other events."
        actions={!!q.data?.unreadCount && <Button variant="outline" onClick={() => readAll.mutate(undefined)}><Check />Mark all read</Button>} />
      {q.isLoading ? <Loading /> : q.error ? <QueryError error={q.error} /> : !q.data!.items.length ? <EmptyState icon={<Bell />} title="You're all caught up" /> : (
        <ul className="divide-y rounded-lg border bg-card">
          {q.data!.items.map(n => (
            <li key={n.id} className={cn("flex items-start gap-3 p-4", !n.isRead && "bg-accent/40")}>
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone[n.severity])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{n.link ? <Link to={n.link} className="hover:underline" onClick={() => !n.isRead && read.mutate(n.id)}>{n.title}</Link> : n.title}</p>
                <p className="text-sm text-muted-foreground">{n.message}</p>
              </div>
              <span className="whitespace-nowrap text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
              {!n.isRead && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Mark read" onClick={() => read.mutate(n.id)}><Check /></Button>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Subscription
function Usage({ label, used, max, fmt = String }: { label: string; used: number; max: number; fmt?: (n: number) => string }) {
  const pct = Math.min(100, Math.round((used / max) * 100));
  return (
    <div><div className="flex justify-between text-sm"><span>{label}</span><span className="text-muted-foreground">{fmt(used)} of {fmt(max)}</span></div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} /></div></div>
  );
}

export function SubscriptionPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["subscription"], queryFn: () => api<Subscription>("/api/subscription") });
  const change = useAction((plan: string) => api("/api/subscription", { method: "PUT", json: { plan } }), { invalidate: [["subscription"]], success: "Plan updated" });
  if (q.isLoading) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  const s = q.data!;
  return (
    <>
      <PageHeader title="Plan and usage" description={`You're on the ${s.plan} plan.`} />
      <Card className="mb-6"><CardContent className="grid gap-5 pt-5 md:grid-cols-3">
        <Usage label="Screens" used={s.usage.devices} max={s.maxDevices} />
        <Usage label="Users" used={s.usage.users} max={s.maxUsers} />
        <Usage label="Storage" used={s.usage.storageBytes} max={s.maxStorageBytes} fmt={formatBytes} />
      </CardContent></Card>
      <FormError error={change.error} />
      <div className="mt-2 grid gap-4 md:grid-cols-3">
        {s.availablePlans.map(p => {
          const current = p.plan === s.plan;
          return (
            <Card key={p.plan} className={cn(current && "border-primary ring-1 ring-primary")}>
              <CardHeader><CardTitle>{p.plan}</CardTitle><CardDescription>{p.monthlyPricePerScreen ? `$${p.monthlyPricePerScreen} per screen / month` : "Free forever"}</CardDescription></CardHeader>
              <CardContent className="grid gap-4">
                <ul className="grid gap-1 text-sm"><li>Up to {p.maxDevices.toLocaleString()} screens</li><li>{p.maxUsers.toLocaleString()} users</li><li>{formatBytes(p.maxStorageBytes)} storage</li></ul>
                {current ? <Badge className="justify-self-start">Current plan</Badge> : can("subscription.manage") &&
                  <Button variant="outline" disabled={change.isPending} onClick={() => change.mutate(p.plan)}>Switch to {p.plan}</Button>}
              </CardContent>
            </Card>);
        })}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Plan changes apply immediately. Payment collection is not connected in this installation; connect a billing provider before charging customers.</p>
    </>
  );
}

// ---------------------------------------------------------------- Settings
export function SettingsPage() {
  const { can, user } = useAuth();
  const q = useQuery({ queryKey: ["organization"], queryFn: () => api<Organization>("/api/organization") });
  const tzs = useTimeZones();
  const [f, setF] = useState({ name: "", defaultTimeZone: "UTC" });
  useEffect(() => { if (q.data) setF({ name: q.data.name, defaultTimeZone: q.data.defaultTimeZone }); }, [q.data]);
  const save = useAction(() => api("/api/organization", { method: "PUT", json: f }), { invalidate: [["organization"]], success: "Settings saved. Sign in again to see the new name everywhere." });
  if (q.isLoading) return <Loading />;
  const editable = can("organization.manage");
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-2xl gap-6">
        <Card><CardHeader><CardTitle>Organization</CardTitle><CardDescription>Screens without a location use the default time zone for schedules.</CardDescription></CardHeader>
          <CardContent><form className="grid gap-4" onSubmit={e => { e.preventDefault(); save.mutate(undefined); }}>
            <Field label="Name" error={fieldError(save.error, "name")}><Input disabled={!editable} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Default time zone" error={fieldError(save.error, "timeZone")}><NativeSelect disabled={!editable} value={f.defaultTimeZone} onChange={e => setF({ ...f, defaultTimeZone: e.target.value })}>
              {(tzs.length ? tzs : [f.defaultTimeZone]).map(t => <option key={t}>{t}</option>)}</NativeSelect></Field>
            {editable && <div><Button disabled={save.isPending}>Save</Button></div>}
          </form></CardContent></Card>
        <Card><CardHeader><CardTitle>Your account</CardTitle></CardHeader>
          <CardContent className="text-sm"><p>{user?.fullName} · {user?.email}</p><p className="text-muted-foreground">Roles: {user?.roles.join(", ")}</p></CardContent></Card>
        <Card><CardHeader><CardTitle>Connect a screen</CardTitle><CardDescription>Screens must be able to reach this server on your network.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <div>
              <p className="font-medium">Android TV and Android tablets</p>
              <p className="text-muted-foreground">Install the Signage Player app, open it, and enter <span className="font-mono text-foreground">{window.location.origin}</span>. It starts on boot and runs full screen.</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button asChild size="sm"><a href="/downloads/signage-player.apk" download>Download Android app (.apk)</a></Button>
                <span className="text-xs text-muted-foreground">On a TV: install the free “Downloader” app and open {window.location.origin}/downloads/signage-player.apk</span>
              </div>
            </div>
            <div>
              <p className="font-medium">Any browser</p>
              <p className="text-muted-foreground">Open <a className="font-mono text-primary hover:underline" href="/player" target="_blank" rel="noreferrer">{window.location.origin}/player</a> on a smart TV browser, stick PC or kiosk.</p>
            </div>
            <p className="text-muted-foreground">The screen shows a 6-character code. Pair it under Devices → Pair a screen.</p>
          </CardContent></Card>
      </div>
    </>
  );
}
