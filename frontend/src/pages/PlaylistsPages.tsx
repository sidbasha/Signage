import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ListVideo, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Media, Playlist } from "@/lib/types";
import { formatDuration, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmButton, EmptyState, Field, FormError, Loading, PageHeader, QueryError, fieldError, useAction } from "@/components/common";
import { MediaThumb } from "./MediaPage";

export function PlaylistsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["playlists"], queryFn: () => api<Playlist[]>("/api/playlists") });
  const create = useAction(() => api<Playlist>("/api/playlists", { method: "POST", json: { name: `New playlist ${new Date().toLocaleDateString()}`, shuffle: false, items: [] } }),
    { invalidate: [["playlists"]], onSuccess: p => navigate(`/playlists/${p.id}`) });
  return (
    <>
      <PageHeader title="Playlists" description="Ordered media that plays in a loop, on a whole screen or inside a layout zone."
        actions={can("playlists.manage") && <Button disabled={create.isPending} onClick={() => create.mutate(undefined)}><Plus />New playlist</Button>} />
      {q.isLoading ? <Loading /> : q.error ? <QueryError error={q.error} /> : !q.data!.length ? <EmptyState icon={<ListVideo />} title="No playlists yet">Create a playlist, add media, then assign it to screens or schedule it.</EmptyState> : (
        <Table><THead><TR><TH>Playlist</TH><TH className="text-right">Items</TH><TH className="text-right">Loop length</TH><TH>Updated</TH></TR></THead>
          <TBody>{q.data!.map(p => (
            <TR key={p.id} className="cursor-pointer" onClick={() => navigate(`/playlists/${p.id}`)}>
              <TD><Link to={`/playlists/${p.id}`} className="font-medium hover:underline" onClick={e => e.stopPropagation()}>{p.name}</Link>{p.shuffle && <span className="ml-2 text-xs text-muted-foreground">shuffled</span>}</TD>
              <TD className="text-right">{p.itemCount}</TD><TD className="text-right">{formatDuration(p.totalDurationSeconds)}</TD><TD>{timeAgo(p.updatedAt)}</TD></TR>))}
          </TBody></Table>
      )}
    </>
  );
}

interface DraftItem { key: string; mediaAssetId: string; name: string; type: string; contentUrl?: string; durationSeconds: number | null; defaultDuration: number; transition: string }

export function PlaylistEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["playlist", id], queryFn: () => api<Playlist>(`/api/playlists/${id}`) });
  const media = useQuery({ queryKey: ["media", "", ""], queryFn: () => api<Media[]>("/api/media") });
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [shuffle, setShuffle] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]); const [dirty, setDirty] = useState(false); const [search, setSearch] = useState("");

  useEffect(() => {
    if (!q.data) return;
    setName(q.data.name); setDescription(q.data.description ?? ""); setShuffle(q.data.shuffle);
    setItems(q.data.items.map(i => ({ key: i.id, mediaAssetId: i.mediaAssetId, name: i.mediaName, type: i.mediaType, contentUrl: i.contentUrl, durationSeconds: i.durationSeconds ?? null,
      defaultDuration: i.durationSeconds == null ? i.effectiveDurationSeconds : 10, transition: i.transition })));
    setDirty(false);
  }, [q.data]);

  const save = useAction(() => api<Playlist>(`/api/playlists/${id}`, { method: "PUT", json: {
    name, description, shuffle, items: items.map(i => ({ mediaAssetId: i.mediaAssetId, durationSeconds: i.durationSeconds, transition: i.transition })) } }),
    { invalidate: [["playlists"], ["playlist", id], ["media"]], success: "Playlist saved. Screens are updating." });
  const edit = (fn: (x: DraftItem[]) => DraftItem[]) => { setItems(fn); setDirty(true); };
  const move = (i: number, d: number) => edit(x => { const c = [...x]; [c[i], c[i + d]] = [c[i + d], c[i]]; return c; });
  const total = items.reduce((s, i) => s + (i.durationSeconds ?? i.defaultDuration), 0);
  const manage = can("playlists.manage");

  if (q.isLoading) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  const library = (media.data ?? []).filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <Link to="/playlists" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Playlists</Link>
      <PageHeader title={name || "Playlist"} description={`${items.length} items · loops every ${formatDuration(total)}`}
        actions={manage && <>
          <ConfirmButton title="Delete this playlist?" description="Screens using it as a default or in a layout zone will stop showing it." confirmLabel="Delete playlist"
            onConfirm={async () => { await api(`/api/playlists/${id}`, { method: "DELETE" }); toast.success("Playlist deleted"); navigate("/playlists"); }}>
            <Button variant="outline"><Trash2 />Delete</Button></ConfirmButton>
          <Button disabled={save.isPending || !dirty} onClick={() => save.mutate(undefined)}>{dirty ? "Save changes" : "Saved"}</Button>
        </>} />
      <FormError error={save.error} />
      <div className="mt-2 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="grid content-start gap-4">
          <Card><CardContent className="grid gap-4 pt-5 sm:grid-cols-[1fr_auto]">
            <Field label="Name" error={fieldError(save.error, "name")}><Input disabled={!manage} value={name} onChange={e => { setName(e.target.value); setDirty(true); }} /></Field>
            <Field label="Shuffle"><div className="flex h-9 items-center"><Switch disabled={!manage} checked={shuffle} onCheckedChange={v => { setShuffle(v); setDirty(true); }} aria-label="Shuffle" /></div></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea disabled={!manage} rows={2} value={description} onChange={e => { setDescription(e.target.value); setDirty(true); }} /></Field>
          </CardContent></Card>
          {items.length === 0 ? <EmptyState icon={<ListVideo />} title="This playlist is empty">{manage ? "Add media from the library." : undefined}</EmptyState> : (
            <ol className="grid gap-2">
              {items.map((it, i) => (
                <li key={it.key} className="flex items-center gap-3 rounded-lg border bg-card p-2 pr-3">
                  <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
                  <MediaThumb m={{ type: it.type as Media["type"], contentUrl: it.contentUrl, name: it.name }} className="h-12 w-20 shrink-0 rounded" />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{it.name}</div><div className="text-xs text-muted-foreground">{it.type}</div></div>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Input type="number" min={1} max={86400} disabled={!manage} className="h-8 w-20" aria-label="Duration in seconds"
                      placeholder={String(it.defaultDuration)} value={it.durationSeconds ?? ""}
                      onChange={e => edit(x => x.map((y, j) => (j === i ? { ...y, durationSeconds: e.target.value ? Number(e.target.value) : null } : y)))} />s
                  </label>
                  <NativeSelect className="h-8 w-24" disabled={!manage} aria-label="Transition" value={it.transition}
                    onChange={e => edit(x => x.map((y, j) => (j === i ? { ...y, transition: e.target.value } : y)))}>
                    <option value="fade">Fade</option><option value="slide">Slide</option><option value="none">Cut</option></NativeSelect>
                  {manage && <div className="flex">
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => edit(x => x.filter((_, j) => j !== i))} aria-label="Remove"><X /></Button>
                  </div>}
                </li>
              ))}
            </ol>
          )}
        </div>
        {manage && (
          <Card className="h-fit lg:sticky lg:top-20">
            <CardHeader className="pb-3"><CardTitle>Library</CardTitle><Input placeholder="Search media" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search library" /></CardHeader>
            <CardContent className="grid max-h-[60vh] gap-1 overflow-y-auto">
              {library.length === 0 ? <p className="text-sm text-muted-foreground">No media. <Link to="/media" className="text-primary hover:underline">Upload some</Link>.</p> : library.map(m => (
                <button key={m.id} className="flex items-center gap-3 rounded-md p-1.5 text-left hover:bg-muted"
                  onClick={() => edit(x => [...x, { key: crypto.randomUUID(), mediaAssetId: m.id, name: m.name, type: m.type, contentUrl: m.contentUrl, durationSeconds: null, defaultDuration: m.durationSeconds, transition: "fade" }])}>
                  <MediaThumb m={m} className="h-9 w-14 shrink-0 rounded" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{m.name}</span><span className="text-xs text-muted-foreground">{m.type} · {formatDuration(m.durationSeconds)}</span></span>
                  <Plus className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
