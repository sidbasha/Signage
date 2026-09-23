import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Device, Layout, Schedule } from "@/lib/types";
import { DAYS, cn, daysLabel } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Checkbox, Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmButton, EmptyState, Field, FormError, Loading, PageHeader, QueryError, fieldError, useAction } from "@/components/common";
import { useRefs } from "./DevicesPage";

const hhmm = (t?: string) => t?.slice(0, 5);

export function SchedulesPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["schedules"], queryFn: () => api<Schedule[]>("/api/schedules") });
  const [edit, setEdit] = useState<Partial<Schedule> | null>(null);
  const del = useAction((id: string) => api(`/api/schedules/${id}`, { method: "DELETE" }), { invalidate: [["schedules"], ["dashboard"]], success: "Schedule deleted" });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Schedules" description="Decide what plays when. Screens evaluate schedules locally in their own time zone, so they keep switching even offline. The highest priority wins when schedules overlap."
        actions={can("schedules.manage") && <Button onClick={() => setEdit({})}><Plus />New schedule</Button>} />
      {q.isLoading ? <Loading /> : q.error ? <QueryError error={q.error} /> : !q.data!.length ? <EmptyState icon={<CalendarClock />} title="No schedules yet">Without schedules, each screen plays its default playlist.</EmptyState> : (
        <Table><THead><TR><TH>Schedule</TH><TH>Plays</TH><TH>When</TH><TH>Screens</TH><TH className="text-right">Priority</TH><TH className="w-24" /></TR></THead>
          <TBody>{q.data!.map(s => {
            const ended = s.endDate && s.endDate < today;
            return (
              <TR key={s.id} className={cn(!s.isActive || ended ? "opacity-60" : "")}>
                <TD><div className="font-medium">{s.name}</div>{!s.isActive ? <Badge variant="secondary">Paused</Badge> : ended ? <Badge variant="secondary">Ended</Badge> : null}</TD>
                <TD>{s.layoutName ? <>Layout · {s.layoutName}</> : <>Playlist · {s.playlistName}</>}</TD>
                <TD className="text-sm"><div>{daysLabel(s.daysOfWeek)}, {s.startTime ? `${hhmm(s.startTime)}–${hhmm(s.endTime)}` : "all day"}</div>
                  <div className="text-xs text-muted-foreground">{s.startDate}{s.endDate ? ` → ${s.endDate}` : " onward"}</div></TD>
                <TD className="max-w-56 truncate text-sm">{s.targets.map(t => t.name).join(", ")}</TD>
                <TD className="text-right">{s.priority}</TD>
                <TD className="text-right">{can("schedules.manage") && <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Edit ${s.name}`} onClick={() => setEdit(s)}><Pencil /></Button>
                  <ConfirmButton title={`Delete ${s.name}?`} description="Screens fall back to other schedules or their default playlist." confirmLabel="Delete" onConfirm={() => del.mutateAsync(s.id)}>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${s.name}`}><Trash2 /></Button></ConfirmButton></div>}</TD>
              </TR>);
          })}</TBody></Table>
      )}
      {edit && <ScheduleDialog value={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ScheduleDialog({ value, onClose }: { value: Partial<Schedule>; onClose: () => void }) {
  const { playlists, groups } = useRefs();
  const layouts = useQuery({ queryKey: ["layouts"], queryFn: () => api<Layout[]>("/api/layouts") }).data ?? [];
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => api<Device[]>("/api/devices") }).data ?? [];
  const [f, setF] = useState({
    name: value.name ?? "", kind: value.layoutId ? "layout" : "playlist", layoutId: value.layoutId ?? "", playlistId: value.playlistId ?? "",
    priority: value.priority ?? 10, startDate: value.startDate ?? new Date().toISOString().slice(0, 10), endDate: value.endDate ?? "",
    allDay: !value.startTime, startTime: hhmm(value.startTime) ?? "09:00", endTime: hhmm(value.endTime) ?? "17:00", daysOfWeek: value.daysOfWeek ?? 127, isActive: value.isActive ?? true,
    deviceIds: value.targets?.filter(t => t.deviceId).map(t => t.deviceId!) ?? [], deviceGroupIds: value.targets?.filter(t => t.deviceGroupId).map(t => t.deviceGroupId!) ?? [],
  });
  const save = useAction(() => api(value.id ? `/api/schedules/${value.id}` : "/api/schedules", { method: value.id ? "PUT" : "POST", json: {
    name: f.name, layoutId: f.kind === "layout" ? f.layoutId || null : null, playlistId: f.kind === "playlist" ? f.playlistId || null : null,
    priority: f.priority, startDate: f.startDate, endDate: f.endDate || null, startTime: f.allDay ? null : `${f.startTime}:00`, endTime: f.allDay ? null : `${f.endTime}:00`,
    daysOfWeek: f.daysOfWeek, isActive: f.isActive, deviceIds: f.deviceIds, deviceGroupIds: f.deviceGroupIds } }),
    { invalidate: [["schedules"], ["dashboard"]], success: "Schedule saved. Screens are updating.", onSuccess: onClose });
  const toggle = (arr: string[], id: string, on: boolean) => (on ? [...arr, id] : arr.filter(x => x !== id));
  const e = save.error;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{value.id ? "Edit schedule" : "New schedule"}</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={ev => { ev.preventDefault(); save.mutate(undefined); }}>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Name" error={fieldError(e, "name")}><Input autoFocus required value={f.name} onChange={x => setF({ ...f, name: x.target.value })} /></Field>
            <Field label="Priority" error={fieldError(e, "priority")} hint="0–100"><Input type="number" min={0} max={100} value={f.priority} onChange={x => setF({ ...f, priority: Number(x.target.value) })} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <Field label="Play"><NativeSelect value={f.kind} onChange={x => setF({ ...f, kind: x.target.value })}><option value="playlist">A playlist</option><option value="layout">A layout</option></NativeSelect></Field>
            {f.kind === "playlist"
              ? <Field label="Playlist" error={fieldError(e, "content") ?? fieldError(e, "playlistId")}><NativeSelect required value={f.playlistId} onChange={x => setF({ ...f, playlistId: x.target.value })}>
                  <option value="">Choose…</option>{playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
              : <Field label="Layout" error={fieldError(e, "content") ?? fieldError(e, "layoutId")}><NativeSelect required value={f.layoutId} onChange={x => setF({ ...f, layoutId: x.target.value })}>
                  <option value="">Choose…</option>{layouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></Field>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" error={fieldError(e, "startDate")}><Input type="date" required value={f.startDate} onChange={x => setF({ ...f, startDate: x.target.value })} /></Field>
            <Field label="Ends" error={fieldError(e, "endDate")} hint="Leave empty to run indefinitely."><Input type="date" value={f.endDate} onChange={x => setF({ ...f, endDate: x.target.value })} /></Field>
          </div>
          <Field label="Days" error={fieldError(e, "daysOfWeek")}>
            <div className="flex flex-wrap gap-1">{DAYS.map((d, i) => {
              const on = !!(f.daysOfWeek & (1 << i));
              return <button type="button" key={d} aria-pressed={on} onClick={() => setF({ ...f, daysOfWeek: f.daysOfWeek ^ (1 << i) })}
                className={cn("h-8 w-11 rounded-md border text-xs font-medium", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{d}</button>;
            })}</div>
          </Field>
          <div className="grid items-end gap-4 sm:grid-cols-3">
            <label className="flex h-9 items-center gap-2 text-sm"><Switch checked={f.allDay} onCheckedChange={v => setF({ ...f, allDay: v })} />All day</label>
            {!f.allDay && <>
              <Field label="From" error={fieldError(e, "startTime")}><Input type="time" required value={f.startTime} onChange={x => setF({ ...f, startTime: x.target.value })} /></Field>
              <Field label="Until" error={fieldError(e, "endTime")} hint={f.endTime <= f.startTime ? "Runs past midnight." : undefined}><Input type="time" required value={f.endTime} onChange={x => setF({ ...f, endTime: x.target.value })} /></Field>
            </>}
          </div>
          <Field label="Screens" error={fieldError(e, "targets")}>
            <div className="grid max-h-44 gap-3 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
              <div><p className="mb-1 text-xs text-muted-foreground">Groups</p>{groups.length ? groups.map(g => (
                <label key={g.id} className="flex items-center gap-2 py-1 text-sm"><Checkbox checked={f.deviceGroupIds.includes(g.id)} onCheckedChange={c => setF({ ...f, deviceGroupIds: toggle(f.deviceGroupIds, g.id, !!c) })} />{g.name} <span className="text-xs text-muted-foreground">({g.devices.length})</span></label>))
                : <p className="text-sm text-muted-foreground">None</p>}</div>
              <div><p className="mb-1 text-xs text-muted-foreground">Individual screens</p>{devices.length ? devices.map(d => (
                <label key={d.id} className="flex items-center gap-2 py-1 text-sm"><Checkbox checked={f.deviceIds.includes(d.id)} onCheckedChange={c => setF({ ...f, deviceIds: toggle(f.deviceIds, d.id, !!c) })} />{d.name}</label>))
                : <p className="text-sm text-muted-foreground">None paired</p>}</div>
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.isActive} onCheckedChange={v => setF({ ...f, isActive: v })} />Active</label>
          {e && !Object.keys((e as { fieldErrors?: object }).fieldErrors ?? {}).length ? <FormError error={e} /> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending}>Save schedule</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
