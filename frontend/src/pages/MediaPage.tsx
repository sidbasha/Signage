import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, Globe, Image as ImageIcon, Pencil, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, mediaUrl, upload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Media } from "@/lib/types";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmButton, EmptyState, Field, Loading, PageHeader, QueryError, fieldError, useAction } from "@/components/common";

const ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.m4v";

/** Reads dimensions (and duration for video) in the browser so the server stores accurate metadata. */
function probe(file: File): Promise<{ width?: number; height?: number; duration?: number }> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const done = (r: { width?: number; height?: number; duration?: number }) => { URL.revokeObjectURL(url); resolve(r); };
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video"); v.preload = "metadata";
      v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, duration: Math.max(1, Math.round(v.duration)) });
      v.onerror = () => done({}); v.src = url;
    } else {
      const img = new Image(); img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight }); img.onerror = () => done({}); img.src = url;
    }
  });
}

export function MediaThumb({ m, className }: { m: Pick<Media, "type" | "contentUrl" | "name">; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center overflow-hidden bg-ink text-white/60", className)}>
      {m.type === "Image" && m.contentUrl ? <img src={mediaUrl(m.contentUrl)} alt="" loading="lazy" className="h-full w-full object-cover" />
        : m.type === "Video" && m.contentUrl ? <video src={`${mediaUrl(m.contentUrl)}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover" />
        : <Globe className="h-6 w-6" />}
    </div>
  );
}

export function MediaPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState(""); const [type, setType] = useState("");
  const [uploads, setUploads] = useState<{ name: string; pct: number; error?: string }[]>([]);
  const [edit, setEdit] = useState<Media | null>(null); const [web, setWeb] = useState(false); const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ["media", search, type], queryFn: () => api<Media[]>(`/api/media?${new URLSearchParams({ search, type })}`) });
  const del = useAction((id: string) => api(`/api/media/${id}`, { method: "DELETE" }), { invalidate: [["media"]], success: "Media deleted" });

  const uploadFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const idx = uploads.length; setUploads(u => [...u, { name: file.name, pct: 0 }]);
      try {
        const meta = await probe(file);
        const form = new FormData();
        form.append("file", file);
        if (meta.width) form.append("width", String(meta.width));
        if (meta.height) form.append("height", String(meta.height));
        if (meta.duration) form.append("durationSeconds", String(meta.duration));
        await upload<Media>("/api/media", form, pct => setUploads(u => u.map((x, i) => (x.name === file.name && i >= idx ? { ...x, pct } : x))));
        setUploads(u => u.filter(x => x.name !== file.name));
        toast.success(`Uploaded ${file.name}`);
      } catch (e) {
        setUploads(u => u.map(x => (x.name === file.name ? { ...x, error: (e as Error).message } : x)));
      }
      qc.invalidateQueries({ queryKey: ["media"] }); qc.invalidateQueries({ queryKey: ["dashboard"] });
    }
  };

  const manage = can("media.manage");
  return (
    <>
      <PageHeader title="Media" description="Images, videos and web pages for your playlists. Files are checksummed so screens can verify what they cache."
        actions={manage && <>
          <Button variant="outline" onClick={() => setWeb(true)}><Globe />Add web page</Button>
          <Button onClick={() => input.current?.click()}><Upload />Upload</Button>
          <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ""; }} />
        </>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Search name or tag" className="w-60" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search media" />
        <NativeSelect className="w-36" value={type} onChange={e => setType(e.target.value)} aria-label="Type"><option value="">All types</option><option>Image</option><option>Video</option><option>Web</option></NativeSelect>
      </div>
      {uploads.length > 0 && (
        <div className="mb-4 grid gap-2 rounded-lg border bg-card p-3">
          {uploads.map((u, i) => (
            <div key={i} className="text-sm">
              <div className="flex justify-between"><span className="truncate">{u.name}</span><span className={u.error ? "text-destructive" : "text-muted-foreground"}>{u.error ?? `${u.pct}%`}</span></div>
              {!u.error && <div className="mt-1 h-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${u.pct}%` }} /></div>}
              {u.error && <button className="text-xs text-muted-foreground underline" onClick={() => setUploads(x => x.filter((_, j) => j !== i))}>Dismiss</button>}
            </div>))}
        </div>
      )}
      <div onDragOver={e => { if (manage) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (manage && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); }}
        className={cn("rounded-lg transition-colors", drag && "bg-accent ring-2 ring-primary")}>
        {q.isLoading ? <Loading /> : q.error ? <QueryError error={q.error} /> : !q.data!.length ? (
          <EmptyState icon={<ImageIcon />} title={search || type ? "Nothing matches" : "Your library is empty"}
            action={manage && !search && <Button onClick={() => input.current?.click()}><Upload />Upload files</Button>}>
            {manage && !search ? "Drop images or videos here. JPG, PNG, GIF, WEBP, MP4 and WEBM up to 1 GB." : undefined}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {q.data!.map(m => (
              <div key={m.id} className="group overflow-hidden rounded-lg border bg-card">
                <MediaThumb m={m} className="aspect-video" />
                <div className="p-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {m.type === "Video" ? <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : m.type === "Web" ? <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="truncate" title={m.name}>{m.name}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {m.type === "Web" ? "Web page" : formatBytes(m.sizeBytes)} · {formatDuration(m.durationSeconds)}{m.width ? ` · ${m.width}×${m.height}` : ""}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{m.usedInPlaylists ? `In ${m.usedInPlaylists} playlist${m.usedInPlaylists > 1 ? "s" : ""}` : "Unused"}</span>
                    {manage && <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${m.name}`} onClick={() => setEdit(m)}><Pencil /></Button>
                      <ConfirmButton title={`Delete ${m.name}?`} description="The file is removed from storage. Screens drop it on their next sync." confirmLabel="Delete" onConfirm={() => del.mutateAsync(m.id)}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Delete ${m.name}`}><Trash2 /></Button>
                      </ConfirmButton>
                    </div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {edit && <MediaDialog media={edit} onClose={() => setEdit(null)} />}
      {web && <MediaDialog onClose={() => setWeb(false)} />}
    </>
  );
}

function MediaDialog({ media, onClose }: { media?: Media; onClose: () => void }) {
  const [f, setF] = useState({ name: media?.name ?? "", durationSeconds: media?.durationSeconds ?? 15, tags: media?.tags ?? "", url: media?.url ?? "https://" });
  const save = useAction((v: typeof f) => media ? api(`/api/media/${media.id}`, { method: "PUT", json: v }) : api("/api/media/web", { method: "POST", json: v }),
    { invalidate: [["media"], ["playlists"]], success: media ? "Media saved" : "Web page added", onSuccess: onClose });
  const isWeb = !media || media.type === "Web";
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{media ? "Edit media" : "Add web page"}</DialogTitle></DialogHeader>
        {media && media.type !== "Web" && <MediaThumb m={media} className="aspect-video rounded-md" />}
        <form className="grid gap-4" onSubmit={e => { e.preventDefault(); save.mutate(f); }}>
          <Field label="Name" error={fieldError(save.error, "name")}><Input autoFocus required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          {isWeb && <Field label="Address" error={fieldError(save.error, "url")} hint="The page must allow being shown in a frame."><Input type="url" required value={f.url} onChange={e => setF({ ...f, url: e.target.value })} /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default duration (seconds)" error={fieldError(save.error, "durationSeconds")} hint={media?.type === "Video" ? "Videos play to the end." : undefined}>
              <Input type="number" min={1} max={86400} value={f.durationSeconds} onChange={e => setF({ ...f, durationSeconds: Number(e.target.value) })} /></Field>
            <Field label="Tags"><Input placeholder="menu, summer" value={f.tags} onChange={e => setF({ ...f, tags: e.target.value })} /></Field>
          </div>
          {media?.sha256 && <p className="truncate font-mono text-xs text-muted-foreground" title={media.sha256}>sha256 {media.sha256}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
