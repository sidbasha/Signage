import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Layout, Playlist, Zone } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmButton, EmptyState, Field, FormError, Loading, PageHeader, QueryError, fieldError, useAction } from "@/components/common";

const ZONE_TINTS = ["bg-primary/80", "bg-[hsl(37_72%_50%/.8)]", "bg-[hsl(211_40%_45%/.8)]", "bg-[hsl(8_58%_46%/.75)]", "bg-[hsl(150_35%_38%/.8)]", "bg-[hsl(265_30%_50%/.75)]"];

function LayoutPreview({ layout, className }: { layout: Pick<Layout, "width" | "height" | "backgroundColor" | "zones">; className?: string }) {
  return (
    <div className={cn("relative w-full overflow-hidden rounded border-4 border-ink", className)} style={{ aspectRatio: `${layout.width}/${layout.height}`, background: layout.backgroundColor }}>
      {layout.zones.map((z, i) => (
        <div key={i} className={cn("absolute border border-white/40", ZONE_TINTS[i % ZONE_TINTS.length])}
          style={{ left: `${z.x}%`, top: `${z.y}%`, width: `${z.width}%`, height: `${z.height}%`, zIndex: z.zIndex }}>
          <span className="absolute left-1 top-0.5 text-[10px] text-white">{z.name}</span>
        </div>
      ))}
    </div>
  );
}

export function LayoutsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const layouts = useQuery({ queryKey: ["layouts"], queryFn: () => api<Layout[]>("/api/layouts") });
  const templates = useQuery({ queryKey: ["layouts", "templates"], queryFn: () => api<Layout[]>("/api/layouts/templates") });
  const [from, setFrom] = useState<Layout | null>(null);
  const [name, setName] = useState("");
  const create = useAction((v: { t: Layout; name: string }) => api<Layout>(`/api/layouts/from-template/${v.t.id}`, { method: "POST", json: { name: v.name } }),
    { invalidate: [["layouts"]], onSuccess: l => { setFrom(null); navigate(`/layouts/${l.id}`); } });
  const grid = (list: Layout[], template: boolean) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {list.map(l => (
        <Card key={l.id} className="overflow-hidden">
          <div className="bg-muted p-4"><LayoutPreview layout={l} className={l.orientation === "Portrait" ? "mx-auto max-w-[40%]" : ""} /></div>
          <CardContent className="flex items-center justify-between gap-2 pt-4">
            <div className="min-w-0"><div className="truncate font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{l.zones.length} zone{l.zones.length > 1 ? "s" : ""} · {l.width}×{l.height}</div></div>
            {template ? can("layouts.manage") && <Button size="sm" variant="outline" onClick={() => { setName(`${l.name} layout`); setFrom(l); create.reset(); }}>Use</Button>
              : <Button size="sm" variant="outline" asChild><Link to={`/layouts/${l.id}`}>{can("layouts.manage") ? "Edit" : "View"}</Link></Button>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
  return (
    <>
      <PageHeader title="Layouts" description="Split a screen into zones, each playing its own playlist. Start from a template." />
      <Tabs defaultValue="mine">
        <TabsList><TabsTrigger value="mine">Your layouts</TabsTrigger><TabsTrigger value="templates">Templates</TabsTrigger></TabsList>
        <TabsContent value="mine">{layouts.isLoading ? <Loading /> : layouts.error ? <QueryError error={layouts.error} /> : layouts.data!.length ? grid(layouts.data!, false)
          : <EmptyState icon={<LayoutTemplate />} title="No layouts yet">Pick a template to create your first multi-zone layout.</EmptyState>}</TabsContent>
        <TabsContent value="templates">{templates.data ? grid(templates.data, true) : <Loading />}</TabsContent>
      </Tabs>
      <Dialog open={!!from} onOpenChange={o => !o && setFrom(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>New layout from “{from?.name}”</DialogTitle></DialogHeader>
          <form className="grid gap-4" onSubmit={e => { e.preventDefault(); create.mutate({ t: from!, name }); }}>
            <Field label="Layout name" error={fieldError(create.error, "name")}><Input autoFocus required value={name} onChange={e => setName(e.target.value)} /></Field>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setFrom(null)}>Cancel</Button><Button disabled={create.isPending}>Create and edit</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const round = (n: number) => Math.round(n * 2) / 2; // snap to 0.5%
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function LayoutEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["layout", id], queryFn: () => api<Layout>(`/api/layouts/${id}`) });
  const playlists = useQuery({ queryKey: ["playlists"], queryFn: () => api<Playlist[]>("/api/playlists") }).data ?? [];
  const [l, setL] = useState<Layout | null>(null); const [sel, setSel] = useState(0); const [dirty, setDirty] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => { if (q.data) { setL(q.data); setDirty(false); } }, [q.data]);
  const save = useAction(() => api<Layout>(`/api/layouts/${id}`, { method: "PUT", json: { ...l, zones: l!.zones.map(z => ({ ...z, playlistId: z.playlistId || null })) } }),
    { invalidate: [["layouts"], ["layout", id]], success: "Layout saved" });
  const manage = can("layouts.manage");
  if (q.isLoading || !l) return q.error ? <QueryError error={q.error} /> : <Loading />;

  const update = (patch: Partial<Layout>) => { setL({ ...l, ...patch }); setDirty(true); };
  const setZone = (i: number, patch: Partial<Zone>) => update({ zones: l.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) });

  /** Drag the zone body to move, the corner handle to resize. Coordinates are % of the screen. */
  const startDrag = (e: React.PointerEvent, i: number, mode: "move" | "resize") => {
    if (!manage) return;
    e.preventDefault(); e.stopPropagation(); setSel(i);
    const rect = canvas.current!.getBoundingClientRect(); const z0 = l.zones[i]; const sx = e.clientX, sy = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - sx) / rect.width) * 100, dy = ((ev.clientY - sy) / rect.height) * 100;
      if (mode === "move") setZone(i, { x: round(clamp(z0.x + dx, 0, 100 - z0.width)), y: round(clamp(z0.y + dy, 0, 100 - z0.height)) });
      else setZone(i, { width: round(clamp(z0.width + dx, 5, 100 - z0.x)), height: round(clamp(z0.height + dy, 5, 100 - z0.y)) });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  };
  const z = l.zones[sel];
  return (
    <>
      <Link to="/layouts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Layouts</Link>
      <PageHeader title={l.name} description="Drag zones to move them; drag the corner to resize. Assign a playlist to each zone."
        actions={manage && <>
          <ConfirmButton title="Delete this layout?" description="Layouts used by a schedule can't be deleted." confirmLabel="Delete layout"
            onConfirm={async () => { await api(`/api/layouts/${id}`, { method: "DELETE" }); toast.success("Layout deleted"); navigate("/layouts"); }}>
            <Button variant="outline"><Trash2 />Delete</Button></ConfirmButton>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(undefined)}>{dirty ? "Save layout" : "Saved"}</Button></>} />
      <FormError error={save.error} />
      <div className="mt-2 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-4">
          <div ref={canvas} className={cn("relative mx-auto touch-none select-none overflow-hidden rounded border-[6px] border-ink", l.orientation === "Portrait" ? "max-w-[45%]" : "")}
            style={{ aspectRatio: `${l.width}/${l.height}`, background: l.backgroundColor }}>
            {l.zones.map((zone, i) => (
              <div key={i} onPointerDown={e => startDrag(e, i, "move")}
                className={cn("absolute border-2", ZONE_TINTS[i % ZONE_TINTS.length], manage && "cursor-move", sel === i ? "border-white ring-2 ring-white/60" : "border-white/30")}
                style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%`, zIndex: zone.zIndex }}>
                <div className="p-1.5 text-xs text-white"><div className="font-medium">{zone.name}</div><div className="opacity-80">{playlists.find(p => p.id === zone.playlistId)?.name ?? "No playlist"}</div></div>
                {manage && <div onPointerDown={e => startDrag(e, i, "resize")} className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize bg-white" aria-hidden />}
              </div>
            ))}
          </div>
        </Card>
        <div className="grid content-start gap-4">
          <Card><CardHeader className="pb-3"><CardTitle>Screen</CardTitle></CardHeader><CardContent className="grid gap-3">
            <Field label="Name" error={fieldError(save.error, "name")}><Input disabled={!manage} value={l.name} onChange={e => update({ name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Orientation"><NativeSelect disabled={!manage} value={l.orientation} onChange={e => {
                const o = e.target.value as Layout["orientation"]; if (o !== l.orientation) update({ orientation: o, width: l.height, height: l.width }); }}><option>Landscape</option><option>Portrait</option></NativeSelect></Field>
              <Field label="Background"><Input type="color" disabled={!manage} className="h-9 p-1" value={l.backgroundColor} onChange={e => update({ backgroundColor: e.target.value })} /></Field>
            </div>
          </CardContent></Card>
          <Card><CardHeader className="flex-row items-center justify-between pb-3"><CardTitle>Zones</CardTitle>
            {manage && l.zones.length < 12 && <Button size="sm" variant="outline" onClick={() => { update({ zones: [...l.zones, { name: `Zone ${l.zones.length + 1}`, x: 10, y: 10, width: 30, height: 30, zIndex: l.zones.length, playlistId: null }] }); setSel(l.zones.length); }}><Plus />Add</Button>}
          </CardHeader><CardContent className="grid gap-3">
            <div className="flex flex-wrap gap-1">{l.zones.map((zone, i) => (
              <button key={i} onClick={() => setSel(i)} className={cn("rounded-md border px-2 py-1 text-xs", sel === i ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted")}>{zone.name}</button>))}</div>
            {z && <>
              <Field label="Zone name" error={fieldError(save.error, `zones[${sel}].name`)}><Input disabled={!manage} value={z.name} onChange={e => setZone(sel, { name: e.target.value })} /></Field>
              <Field label="Playlist"><NativeSelect disabled={!manage} value={z.playlistId ?? ""} onChange={e => setZone(sel, { playlistId: e.target.value || null })}>
                <option value="">None (zone stays empty)</option>{playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
              <div className="grid grid-cols-4 gap-2">
                {(["x", "y", "width", "height"] as const).map(k => (
                  <Field key={k} label={k === "width" ? "W %" : k === "height" ? "H %" : `${k.toUpperCase()} %`}>
                    <Input type="number" step={0.5} min={0} max={100} disabled={!manage} className="px-2" value={z[k]} onChange={e => setZone(sel, { [k]: Number(e.target.value) })} /></Field>))}
              </div>
              {fieldError(save.error, `zones[${sel}]`) && <p className="text-xs text-destructive">{fieldError(save.error, `zones[${sel}]`)}</p>}
              {manage && l.zones.length > 1 && <Button variant="ghost" size="sm" className="justify-self-start text-destructive" onClick={() => { update({ zones: l.zones.filter((_, j) => j !== sel) }); setSel(0); }}><Trash2 />Remove zone</Button>}
            </>}
          </CardContent></Card>
        </div>
      </div>
    </>
  );
}
