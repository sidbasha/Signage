import { Link } from "react-router-dom";
import { cn, timeAgo } from "@/lib/utils";
import { StatusDot } from "./common";

/**
 * The device wall tile: each screen drawn as a small display in its real orientation,
 * glowing teal when live. This is the one expressive element in an otherwise quiet UI.
 */
export function ScreenTile({ id, name, status, orientation, type, location, currentItem, lastSeenAt }:
  { id: string; name: string; status: "Online" | "Offline"; orientation: string; type: string; location?: string | null; currentItem?: string | null; lastSeenAt?: string | null }) {
  const online = status === "Online";
  const portrait = orientation === "Portrait";
  return (
    <Link to={`/devices/${id}`} className="group flex flex-col items-center gap-2 rounded-lg p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className={cn("relative flex h-28 w-full items-center justify-center")}>
        <div className={cn(
          "relative overflow-hidden rounded-[5px] border-[5px] border-ink bg-ink transition-shadow",
          portrait ? "h-28 w-[63px]" : "h-[74px] w-[132px]",
          online ? "shadow-[0_0_0_1px_hsl(var(--primary)/.35),0_8px_24px_-8px_hsl(var(--primary)/.55)]" : "opacity-80",
        )}>
          <div className={cn("absolute inset-0", online ? "bg-[linear-gradient(135deg,hsl(184_85%_28%),hsl(190_60%_18%))]" : "bg-ink-soft")} />
          <div className="absolute inset-x-1.5 bottom-1 truncate text-[9px] leading-tight text-white/85">
            {online ? currentItem ?? "Playing" : "No signal"}
          </div>
        </div>
        <div className={cn("absolute bottom-0 h-1.5 rounded-b bg-ink/80", portrait ? "w-6" : "w-10")} />
      </div>
      <div className="w-full min-w-0 text-center">
        <div className="flex items-center justify-center gap-1.5 text-sm font-medium">
          <StatusDot status={status} /><span className="truncate group-hover:underline">{name}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {location ?? type.replace(/([a-z])([A-Z])/g, "$1 $2")} · {online ? "live" : `seen ${timeAgo(lastSeenAt)}`}
        </div>
      </div>
    </Link>
  );
}
