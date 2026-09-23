import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Device } from "@/lib/types";
import { formatBytes, formatDuration, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmButton, Field, FormError, Loading, QueryError, StatusDot, fieldError, useAction } from "@/components/common";
import { useRefs } from "./DevicesPage";

export function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const navigate = useNavigate();
  const refs = useRefs();
  const q = useQuery({ queryKey: ["device", id], queryFn: () => api<Device>(`/api/devices/${id}`) });
  const plays = useQuery({ queryKey: ["device", id, "playback"], queryFn: () => api<{ mediaAssetId: string; name: string; plays: number; seconds: number; lastPlayedAt: string }[]>(`/api/devices/${id}/playback?days=7`) });
  const [f, setF] = useState({ name: "", locationId: "", defaultPlaylistId: "", orientation: "Landscape", groupIds: [] as string[] });
  useEffect(() => { if (q.data) setF({ name: q.data.name, locationId: q.data.locationId ?? "", defaultPlaylistId: q.data.defaultPlaylistId ?? "", orientation: q.data.orientation, groupIds: q.data.groups.map(g => g.id) }); }, [q.data]);
  const save = useAction((v: typeof f) => api<Device>(`/api/devices/${id}`, { method: "PUT", json: { ...v, locationId: v.locationId || null, defaultPlaylistId: v.defaultPlaylistId || null } }),
    { invalidate: [["device", id], ["devices"], ["dashboard"]], success: "Saved. The screen will pick up changes right away." });
  const command = async (c: string, label: string) => {
    try { await api(`/api/devices/${id}/commands`, { method: "POST", json: { command: c } }); toast.success(label); } catch (e) { toast.error((e as Error).message); }
  };

  if (q.isLoading) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  const d = q.data!;
  const editable = can("devices.manage");
  const info: [string, string | undefined][] = [
    ["Type", d.type.replace(/([a-z])([A-Z])/g, "$1 $2")], ["Resolution", d.resolution], ["App version", d.appVersion], ["OS", d.osVersion],
    ["IP address", d.ipAddress], ["Paired", new Date(d.pairedAt).toLocaleString()], ["Last seen", timeAgo(d.lastSeenAt)], ["Last sync", timeAgo(d.lastSyncAt)],
    ["Content version", d.syncedVersion], ["Now playing", d.currentItem], ["Free storage", d.freeStorageBytes != null ? formatBytes(d.freeStorageBytes) : undefined],
  ];
  return (
    <>
      <Link to="/devices" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Devices</Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{d.name}</h1>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><StatusDot status={d.status} />{d.status}</span>
        </div>
        {can("devices.command") && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => command("identify", "The screen is showing its name for 10 seconds.")}><Eye />Identify</Button>
            <Button variant="outline" size="sm" onClick={() => command("refresh", "Asked the screen to sync now.")}><RefreshCw />Sync now</Button>
            <Button variant="outline" size="sm" onClick={() => command("reload", "The player is restarting.")}><RotateCw />Restart player</Button>
          </div>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="grid gap-6">
          <Card>
            <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={e => { e.preventDefault(); save.mutate(f); }}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" error={fieldError(save.error, "name")}><Input disabled={!editable} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
                  <Field label="Orientation"><NativeSelect disabled={!editable} value={f.orientation} onChange={e => setF({ ...f, orientation: e.target.value })}><option>Landscape</option><option>Portrait</option></NativeSelect></Field>
                  <Field label="Location" hint="Schedules run in the location's time zone."><NativeSelect disabled={!editable} value={f.locationId} onChange={e => setF({ ...f, locationId: e.target.value })}>
                    <option value="">None (organization time zone)</option>{refs.locations.map(l => <option key={l.id} value={l.id}>{l.name} · {l.timeZone}</option>)}</NativeSelect></Field>
                  <Field label="Default playlist" hint="Plays whenever no schedule applies."><NativeSelect disabled={!editable} value={f.defaultPlaylistId} onChange={e => setF({ ...f, defaultPlaylistId: e.target.value })}>
                    <option value="">None (use group default)</option>{refs.playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
                </div>
                {refs.groups.length > 0 && (
                  <Field label="Groups"><div className="flex flex-wrap gap-3">{refs.groups.map(g => (
                    <label key={g.id} className="flex items-center gap-2 text-sm"><Checkbox disabled={!editable} checked={f.groupIds.includes(g.id)}
                      onCheckedChange={c => setF({ ...f, groupIds: c ? [...f.groupIds, g.id] : f.groupIds.filter(x => x !== g.id) })} />{g.name}</label>))}</div></Field>
                )}
                <FormError error={save.error && !fieldError(save.error, "name") ? save.error : null} />
                {editable && <div><Button disabled={save.isPending}>Save changes</Button></div>}
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Proof of play, last 7 days</CardTitle></CardHeader>
            <CardContent>
              {!plays.data?.length ? <p className="text-sm text-muted-foreground">No playback reported yet.</p> : (
                <Table><THead><TR><TH>Media</TH><TH className="text-right">Plays</TH><TH className="text-right">Screen time</TH><TH>Last played</TH></TR></THead>
                  <TBody>{plays.data.map(p => <TR key={p.mediaAssetId ?? p.name}><TD>{p.name}</TD><TD className="text-right">{p.plays}</TD><TD className="text-right">{formatDuration(p.seconds)}</TD><TD>{timeAgo(p.lastPlayedAt)}</TD></TR>)}</TBody></Table>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Device</CardTitle></CardHeader>
            <CardContent><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {info.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="truncate font-mono text-xs leading-5">{v ?? "—"}</dd></div>)}
            </dl></CardContent>
          </Card>
          {editable && (
            <ConfirmButton title={`Unpair ${d.name}?`} description="The screen stops playing and returns to its pairing code. Its key is revoked immediately." confirmLabel="Unpair screen"
              onConfirm={async () => { await api(`/api/devices/${id}`, { method: "DELETE" }); toast.success("Screen unpaired"); navigate("/devices"); }}>
              <Button variant="outline" className="w-full text-destructive"><Trash2 />Unpair screen</Button>
            </ConfirmButton>
          )}
        </div>
      </div>
    </>
  );
}
