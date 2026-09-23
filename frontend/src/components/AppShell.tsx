import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarClock, ChevronDown, CreditCard, FolderTree, Image, LayoutDashboard, LayoutTemplate, ListVideo, LogOut, MapPin, Menu, MonitorPlay, ScrollText, Settings, Shield, Users, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { useAdminRealtime } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";

interface NavItem { to: string; label: string; icon: ReactNode; perm: string }
const sections: { title: string; items: NavItem[] }[] = [
  { title: "", items: [{ to: "/", label: "Overview", icon: <LayoutDashboard />, perm: "dashboard.view" }] },
  { title: "Screens", items: [
    { to: "/devices", label: "Devices", icon: <MonitorPlay />, perm: "devices.view" },
    { to: "/groups", label: "Device groups", icon: <FolderTree />, perm: "devices.view" },
    { to: "/locations", label: "Locations", icon: <MapPin />, perm: "locations.view" },
  ] },
  { title: "Content", items: [
    { to: "/media", label: "Media", icon: <Image />, perm: "media.view" },
    { to: "/playlists", label: "Playlists", icon: <ListVideo />, perm: "playlists.view" },
    { to: "/layouts", label: "Layouts", icon: <LayoutTemplate />, perm: "layouts.view" },
    { to: "/schedules", label: "Schedules", icon: <CalendarClock />, perm: "schedules.view" },
  ] },
  { title: "Administration", items: [
    { to: "/users", label: "Users", icon: <Users />, perm: "users.view" },
    { to: "/roles", label: "Roles", icon: <Shield />, perm: "users.view" },
    { to: "/audit", label: "Audit log", icon: <ScrollText />, perm: "audit.view" },
    { to: "/subscription", label: "Plan and usage", icon: <CreditCard />, perm: "subscription.view" },
    { to: "/settings", label: "Settings", icon: <Settings />, perm: "dashboard.view" },
  ] },
];

export function AppShell() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const live = useAdminRealtime(!!user);
  const [open, setOpen] = useState(false);
  const { data: notes } = useQuery({ queryKey: ["notifications", "count"], queryFn: () => api<{ unreadCount: number }>("/api/notifications?take=1"), refetchInterval: 60_000 });

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {sections.map(s => {
        const items = s.items.filter(i => can(i.perm));
        if (!items.length) return null;
        return (
          <div key={s.title || "home"}>
            {s.title && <p className="mb-1 px-3 text-xs text-white/45">{s.title}</p>}
            {items.map(i => (
              <NavLink key={i.to} to={i.to} end={i.to === "/"} onClick={() => setOpen(false)}
                className={({ isActive }) => cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm text-white/75 transition-colors hover:bg-white/5 hover:text-white [&_svg]:size-4",
                  isActive && "bg-white/10 text-white")}>
                {i.icon}{i.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-ink text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-14 items-center justify-between px-5">
          <span className="flex items-center gap-2 font-semibold"><img src="/favicon.svg" alt="" className="h-6 w-6 rounded bg-white p-0.5" />Signage CMS</span>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        {nav}
        <div className="border-t border-white/10 px-5 py-3 text-xs text-white/50">{user?.organizationName}</div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></Button>
          <div className="flex-1" />
          <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex" title="Live updates from screens">
            <span className={cn("h-1.5 w-1.5 rounded-full", live === "live" ? "bg-primary" : live === "connecting" ? "bg-warning" : "bg-destructive")} />
            {live === "live" ? "Live" : live === "connecting" ? "Connecting" : "Updates paused"}
          </span>
          <Button variant="ghost" size="icon" className="relative" onClick={() => navigate("/notifications")} aria-label="Notifications">
            <Bell />
            {!!notes?.unreadCount && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">{notes.unreadCount > 99 ? "99+" : notes.unreadCount}</span>}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{user?.fullName.split(" ").map(p => p[0]).slice(0, 2).join("")}</span>
                <span className="hidden text-sm sm:inline">{user?.fullName}</span><ChevronDown className="opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user?.email}<br />{user?.roles.join(", ")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate("/settings")}><Settings />Settings</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => window.open("/player", "_blank")}><MonitorPlay />Open web player</DropdownMenuItem>
              <DropdownMenuItem onSelect={async () => { await logout(); navigate("/login"); }}><LogOut />Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8"><Outlet /></main>
      </div>
    </div>
  );
}
