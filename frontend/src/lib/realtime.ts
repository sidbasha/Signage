import { useEffect, useState } from "react";
import * as signalR from "@microsoft/signalr";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { API_BASE, getAccessToken } from "./api";
import type { Device, Notification } from "./types";

/**
 * Connects the admin UI to /hubs/admin. Device status changes are patched straight into cached
 * queries so the device wall updates without refetching; notifications raise a toast.
 */
export function useAdminRealtime(enabled: boolean) {
  const qc = useQueryClient();
  const [state, setState] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    if (!enabled) return;
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(`${API_BASE}/hubs/admin`, { accessTokenFactory: getAccessToken })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    conn.on("DeviceStatus", (p: { id: string; status: Device["status"]; lastSeenAt?: string; currentItem?: string; syncedVersion?: string }) => {
      const patch = (d: Device) => (d.id === p.id ? { ...d, status: p.status, lastSeenAt: p.lastSeenAt, currentItem: p.currentItem, syncedVersion: p.syncedVersion } : d);
      qc.setQueriesData<Device[]>({ queryKey: ["devices"] }, old => (Array.isArray(old) ? old.map(patch) : old));
      qc.setQueryData<Device>(["device", p.id], old => (old ? patch(old) : old));
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    });
    conn.on("Notification", (n: Notification) => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      const fn = n.severity === "Warning" || n.severity === "Error" ? toast.warning : toast.success;
      fn(n.title, { description: n.message });
    });
    conn.onreconnecting(() => setState("connecting"));
    conn.onreconnected(() => { setState("live"); qc.invalidateQueries(); });
    conn.onclose(() => setState("offline"));

    let stopped = false;
    const start = async () => {
      try { await conn.start(); if (!stopped) setState("live"); }
      catch { if (!stopped) { setState("offline"); setTimeout(start, 5000); } }
    };
    start();
    return () => { stopped = true; conn.stop(); };
  }, [enabled, qc]);

  return state;
}
