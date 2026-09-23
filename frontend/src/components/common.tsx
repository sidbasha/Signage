import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import type { DeviceStatus } from "@/lib/types";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-14 text-center">
      {icon && <div className="mb-3 text-muted-foreground [&_svg]:size-8">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Label + control + message. Links the label to the control and the message to aria-describedby automatically. */
export function Field({ label, error, hint, children, className, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string; htmlFor?: string }) {
  const auto = useId();
  const child = isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : null;
  // Only form controls get the id; composite children (checkbox lists, day pickers) stay as they are.
  const isControl = child && typeof child.type !== "string" ? true : child ? ["input", "select", "textarea"].includes(child.type as string) : false;
  const id = htmlFor ?? (child?.props.id as string | undefined) ?? (isControl ? auto : undefined);
  const msgId = `${auto}-msg`;
  const control = child && isControl && id
    ? cloneElement(child, { id, "aria-invalid": error ? true : undefined, "aria-describedby": error || hint ? msgId : undefined })
    : children;
  return (
    <div className={cn("grid gap-1.5", className)} role={id ? undefined : "group"} aria-label={id ? undefined : label}>
      {id ? <Label htmlFor={id}>{label}</Label> : <span className="text-sm font-medium leading-none">{label}</span>}
      {control}
      {error ? <p id={msgId} className="text-xs text-destructive">{error}</p> : hint ? <p id={msgId} className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? (Object.keys(error.fieldErrors).length ? Object.values(error.fieldErrors).flat()[0] : error.message) : "Something went wrong.";
  return <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{msg}</p>;
}

export const fieldError = (e: unknown, name: string) => (e instanceof ApiError ? e.field(name) : undefined);

export function StatusDot({ status, className }: { status: DeviceStatus | "Pending"; className?: string }) {
  return (
    <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full",
      status === "Online" ? "animate-signal bg-primary" : status === "Pending" ? "bg-warning" : "bg-destructive", className)}
      aria-label={status} />
  );
}

/** Wraps useMutation with cache invalidation and a success toast named after the action. */
export function useAction<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, opts: { invalidate?: QueryKey[]; success?: string; onSuccess?: (r: TRes) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      opts.invalidate?.forEach(k => qc.invalidateQueries({ queryKey: k }));
      if (opts.success) toast.success(opts.success);
      opts.onSuccess?.(r);
    },
  });
}

export function ConfirmButton({ title, description, confirmLabel, onConfirm, children, variant = "destructive" }:
  { title: string; description: string; confirmLabel: string; onConfirm: () => Promise<unknown>; children: ReactNode; variant?: "destructive" | "default" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <span onClick={() => { setError(null); setOpen(true); }}>{children}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
          <FormError error={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={variant} disabled={busy} onClick={async () => {
              setBusy(true); setError(null);
              try { await onConfirm(); setOpen(false); } catch (e) { setError(e); } finally { setBusy(false); }
            }}>{confirmLabel}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="py-16 text-center text-sm text-muted-foreground" role="status">{label}</div>;
}

export function QueryError({ error }: { error: unknown }) {
  return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error instanceof Error ? error.message : "Couldn't load this page."}</div>;
}
