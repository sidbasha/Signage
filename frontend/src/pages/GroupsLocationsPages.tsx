import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderTree, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Device, DeviceGroup, Location } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmButton, EmptyState, Field, FormError, Loading, PageHeader, QueryError, fieldError, useAction } from "@/components/common";
import { useRefs } from "./DevicesPage";

export const useTimeZones = () => useQuery({ queryKey: ["timezones"], queryFn: () => api<string[]>("/api/timezones"), staleTime: Infinity }).data ?? [];

export function LocationsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["locations"], queryFn: () => api<Location[]>("/api/locations") });
  const [edit, setEdit] = useState<Partial<Location> | null>(null);
  const del = useAction((id: string) => api(`/api/locations/${id}`, { method: "DELETE" }), { invalidate: [["locations"], ["devices"]], success: "Location deleted" });
  return (
    <>
      <PageHeader title="Locations" description="Sites where your screens live. Each location has its own time zone for scheduling."
        actions={can("locations.manage") && <Button onClick={() => setEdit({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}><Plus />Add location</Button>} />
      {q.isLoading ? <Loading /> : q.error ? <QueryError error={q.error} /> : !q.data!.length ? <EmptyState icon={<MapPin />} title="No locations yet">Add your stores, offices or venues to organize screens and schedule in local time.</EmptyState> : (
        <Table><THead><TR><TH>Name</TH><TH>Place</TH><TH>Time zone</TH><TH className="text-right">Screens</TH><TH className="w-24" /></TR></THead>
          <TBody>{q.data!.map(l => (
            <TR key={l.id}><TD className="font-medium">{l.name}</TD><TD>{[l.city, l.country].filter(Boolean).join(", ") || "—"}</TD><TD className="font-mono text-xs">{l.timeZone}</TD>
              <TD className="text-right">{l.deviceCount}</TD>
              <TD className="text-right">{can("locations.manage") && <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" aria-label={`Edit ${l.name}`} onClick={() => setEdit(l)}><Pencil /></Button>
                <ConfirmButton title={`Delete ${l.name}?`} description="Screens at this location stay paired and fall back to the organization time zone." confirmLabel="Delete" onConfirm={() => del.mutateAsync(l.id)}>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${l.name}`}><Trash2 /></Button></ConfirmButton></div>}</TD></TR>))}
          </TBody></Table>
      )}
      {edit && <LocationDialog value={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function LocationDialog({ value, onClose }: { value: Partial<Location>; onClose: () => void }) {
  const tzs = useTimeZones();
  const [f, setF] = useState({ name: value.name ?? "", address: value.address ?? "", city: value.city ?? "", country: value.country ?? "", timeZone: value.timeZone ?? "UTC" });
  const save = useAction((v: typeof f) => api(value.id ? `/api/locations/${value.id}` : "/api/locations", { method: value.id ? "PUT" : "POST", json: v }),
    { invalidate: [["locations"]], success: value.id ? "Location saved" : "Location added", onSuccess: onClose });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{value.id ? "Edit location" : "Add location"}</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={e => { e.preventDefault(); save.mutate(f); }}>
          <Field label="Name" error={fieldError(save.error, "name")}><Input autoFocus required value={f.name} onChange={set("name")} /></Field>
          <Field label="Address"><Input value={f.address} onChange={set("address")} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="City"><Input value={f.city} onChange={set("city")} /></Field><Field label="Country"><Input value={f.country} onChange={set("country")} /></Field></div>
          <Field label="Time zone" error={fieldError(save.error, "timeZone")}><NativeSelect value={f.timeZone} onChange={set("timeZone")}>{(tzs.length ? tzs : [f.timeZone]).map(t => <option key={t}>{t}</option>)}</NativeSelect></Field>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GroupsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["groups"], queryFn: () => api<DeviceGroup[]>("/api/device-groups") });
  const [edit, setEdit] = useState<Partial<DeviceGroup> | null>(null);
  const del = useAction((id: string) => api(`/api/device-groups/${id}`, { method: "DELETE" }), { invalidate: [["groups"], ["devices"]], success: "Group deleted" });
  return (
    <>
      <PageHeader title="Device groups" description="Schedule content to many screens at once, like all reception screens or every menu board."
        actions={can("groups.manage") && <Button onClick={() => setEdit({})}><Plus />New group</Button>} />
      {q.isLoading ? <Loading /> : q.error ? <QueryError error={q.error} /> : !q.data!.length ? <EmptyState icon={<FolderTree />} title="No groups yet">Groups let one schedule reach every screen in the group.</EmptyState> : (
        <Table><THead><TR><TH>Group</TH><TH>Screens</TH><TH>Default playlist</TH><TH className="w-24" /></TR></THead>
          <TBody>{q.data!.map(g => (
            <TR key={g.id}><TD><div className="font-medium">{g.name}</div>{g.description && <div className="text-xs text-muted-foreground">{g.description}</div>}</TD>
              <TD>{g.devices.length ? g.devices.map(d => d.name).join(", ") : <span className="text-muted-foreground">None</span>}</TD><TD>{g.defaultPlaylistName ?? "—"}</TD>
              <TD className="text-right">{can("groups.manage") && <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" aria-label={`Edit ${g.name}`} onClick={() => setEdit(g)}><Pencil /></Button>
                <ConfirmButton title={`Delete ${g.name}?`} description="Schedules that target only this group will stop applying to its screens." confirmLabel="Delete" onConfirm={() => del.mutateAsync(g.id)}>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${g.name}`}><Trash2 /></Button></ConfirmButton></div>}</TD></TR>))}
          </TBody></Table>
      )}
      {edit && <GroupDialog value={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function GroupDialog({ value, onClose }: { value: Partial<DeviceGroup>; onClose: () => void }) {
  const { playlists } = useRefs();
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => api<Device[]>("/api/devices") }).data ?? [];
  const [f, setF] = useState({ name: value.name ?? "", description: value.description ?? "", defaultPlaylistId: value.defaultPlaylistId ?? "", deviceIds: value.devices?.map(d => d.id) ?? [] });
  const save = useAction((v: typeof f) => api(value.id ? `/api/device-groups/${value.id}` : "/api/device-groups", { method: value.id ? "PUT" : "POST", json: { ...v, defaultPlaylistId: v.defaultPlaylistId || null } }),
    { invalidate: [["groups"], ["devices"]], success: "Group saved", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{value.id ? "Edit group" : "New group"}</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={e => { e.preventDefault(); save.mutate(f); }}>
          <Field label="Name" error={fieldError(save.error, "name")}><Input autoFocus required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Description"><Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Default playlist" hint="Used by member screens that have no default of their own."><NativeSelect value={f.defaultPlaylistId} onChange={e => setF({ ...f, defaultPlaylistId: e.target.value })}>
            <option value="">None</option>{playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
          <Field label={`Screens (${f.deviceIds.length})`}>
            <div className="max-h-48 overflow-y-auto rounded-md border p-2">
              {devices.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No screens paired yet.</p> : devices.map(d => (
                <label key={d.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox checked={f.deviceIds.includes(d.id)} onCheckedChange={c => setF({ ...f, deviceIds: c ? [...f.deviceIds, d.id] : f.deviceIds.filter(x => x !== d.id) })} />
                  {d.name}<span className="ml-auto text-xs text-muted-foreground">{d.locationName}</span></label>))}
            </div>
          </Field>
          <FormError error={save.error && !fieldError(save.error, "name") ? save.error : null} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
