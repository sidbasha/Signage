import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MonitorPlay, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Device, DeviceGroup, Location, Playlist } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, Field, FormError, Loading, PageHeader, QueryError, fieldError, useAction } from "@/components/common";
import { ScreenTile } from "@/components/ScreenTile";

export function useRefs() {
  const locations = useQuery({ queryKey: ["locations"], queryFn: () => api<Location[]>("/api/locations") });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<DeviceGroup[]>("/api/device-groups") });
  const playlists = useQuery({ queryKey: ["playlists"], queryFn: () => api<Playlist[]>("/api/playlists") });
  return { locations: locations.data ?? [], groups: groups.data ?? [], playlists: playlists.data ?? [] };
}

export function DevicesPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState(""); const [locationId, setLocationId] = useState(""); const [search, setSearch] = useState("");
  const refs = useRefs();
  const q = useQuery({ queryKey: ["devices", status, locationId], queryFn: () => api<Device[]>(`/api/devices?${new URLSearchParams({ ...(status && { status }), ...(locationId && { locationId }) })}`) });
  const list = (q.data ?? []).filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <PageHeader title="Devices" description="Android TVs, tablets and web players paired to your organization."
        actions={can("devices.pair") && <PairDeviceDialog trigger={<Button><Plus />Pair a screen</Button>} />} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Search screens" className="w-56" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search screens" />
        <NativeSelect className="w-40" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option><option>Online</option><option>Offline</option>
        </NativeSelect>
        <NativeSelect className="w-48" value={locationId} onChange={e => setLocationId(e.target.value)} aria-label="Location">
          <option value="">All locations</option>{refs.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </NativeSelect>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <QueryError error={q.error} /> : list.length === 0 ? (
        <EmptyState icon={<MonitorPlay />} title={q.data?.length ? "No screens match" : "No screens paired yet"}>
          {q.data?.length ? "Try a different filter." : "Open /player on a TV, tablet or browser. It shows a 6-character code; enter it here to pair."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {list.map(d => <ScreenTile key={d.id} {...d} location={d.locationName} />)}
        </div>
      )}
    </>
  );
}

export function PairDeviceDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const refs = useRefs();
  const empty = { code: "", name: "", locationId: "", defaultPlaylistId: "", orientation: "Landscape", groupIds: [] as string[] };
  const [f, setF] = useState(empty);
  const pair = useAction((v: typeof f) => api<Device>("/api/devices/pair", { method: "POST", json: {
    ...v, locationId: v.locationId || null, defaultPlaylistId: v.defaultPlaylistId || null } }),
    { invalidate: [["devices"], ["dashboard"]], success: "Screen paired. It will start playing within a few seconds.", onSuccess: () => { setOpen(false); setF(empty); } });
  return (
    <>
      <span onClick={() => { pair.reset(); setOpen(true); }}>{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pair a screen</DialogTitle>
            <DialogDescription>Open the player on the screen (Android app, or <span className="font-mono">/player</span> in any browser). Enter the code it shows.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={e => { e.preventDefault(); pair.mutate(f); }}>
            <Field label="Pairing code" error={fieldError(pair.error, "code")}>
              <Input autoFocus required maxLength={7} placeholder="ABC234" className="h-12 text-center font-mono text-2xl uppercase tracking-[0.4em]"
                value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Screen name" error={fieldError(pair.error, "name")}><Input required placeholder="Lobby TV" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Location"><NativeSelect value={f.locationId} onChange={e => setF({ ...f, locationId: e.target.value })}>
                <option value="">None</option>{refs.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></Field>
              <Field label="Orientation"><NativeSelect value={f.orientation} onChange={e => setF({ ...f, orientation: e.target.value })}>
                <option>Landscape</option><option>Portrait</option></NativeSelect></Field>
            </div>
            <Field label="Default playlist" hint="Plays whenever no schedule applies."><NativeSelect value={f.defaultPlaylistId} onChange={e => setF({ ...f, defaultPlaylistId: e.target.value })}>
              <option value="">None</option>{refs.playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
            {refs.groups.length > 0 && (
              <Field label="Groups"><div className="flex flex-wrap gap-3">{refs.groups.map(g => (
                <label key={g.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={f.groupIds.includes(g.id)} onCheckedChange={c => setF({ ...f, groupIds: c ? [...f.groupIds, g.id] : f.groupIds.filter(x => x !== g.id) })} />{g.name}
                </label>))}</div></Field>
            )}
            {pair.error && !fieldError(pair.error, "code") && !fieldError(pair.error, "name") ? <FormError error={pair.error} /> : null}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pair.isPending}>{pair.isPending ? "Pairing…" : "Pair screen"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
