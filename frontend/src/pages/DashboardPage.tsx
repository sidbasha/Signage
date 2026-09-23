import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MonitorPlay, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Dashboard } from "@/lib/types";
import { formatBytes, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Loading, PageHeader, QueryError } from "@/components/common";
import { ScreenTile } from "@/components/ScreenTile";
import { PairDeviceDialog } from "./DevicesPage";

export function DashboardPage() {
  const { can, user } = useAuth();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/api/dashboard"), refetchInterval: 30_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  const d = q.data!;
  const stats = [
    { label: "Screens online", value: `${d.devicesOnline} / ${d.devicesTotal}`, to: "/devices" },
    { label: "Media", value: `${d.mediaCount} · ${formatBytes(d.storageBytes)}`, to: "/media" },
    { label: "Playlists", value: d.playlistCount, to: "/playlists" },
    { label: "Active schedules", value: d.activeSchedules, to: "/schedules" },
  ];
  return (
    <>
      <PageHeader title={`${user?.organizationName}`} description="What every screen is doing right now."
        actions={can("devices.pair") && <PairDeviceDialog trigger={<Button><Plus />Pair a screen</Button>} />} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(s => (
          <Link key={s.label} to={s.to} className="rounded-lg border bg-card p-4 transition-colors hover:border-primary/40">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="mt-1 text-xl font-semibold">{s.value}</div>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Device wall</CardTitle>
            {d.devicesOffline > 0 && <span className="text-xs text-destructive">{d.devicesOffline} offline</span>}</CardHeader>
          <CardContent>
            {d.devices.length === 0
              ? <EmptyState icon={<MonitorPlay />} title="No screens yet">Open the web player on any screen, or install the Android app, then pair it with the code it shows.</EmptyState>
              : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">{d.devices.map(x => <ScreenTile key={x.id} {...x} />)}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent>
            {d.recentActivity.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
              <ol className="grid gap-3">
                {d.recentActivity.map(a => (
                  <li key={a.id} className="text-sm">
                    <p>{a.summary ?? a.action}</p>
                    <p className="text-xs text-muted-foreground">{a.userEmail ?? "system"} · {timeAgo(a.createdAt)}</p>
                  </li>
                ))}
              </ol>
            )}
            {can("audit.view") && <Link to="/audit" className="mt-4 inline-block text-sm text-primary hover:underline">Full audit log</Link>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
