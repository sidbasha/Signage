import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export function formatBytes(bytes: number | null | undefined) {
  if (bytes == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function formatDuration(s: number) {
  const m = Math.floor(s / 60), sec = s % 60, h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : m ? `${m}m ${sec ? `${sec}s` : ""}`.trim() : `${sec}s`;
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function daysLabel(mask: number) {
  if (mask === 127) return "Every day";
  if (mask === 62) return "Weekdays";
  if (mask === 65) return "Weekends";
  return DAYS.filter((_, i) => mask & (1 << i)).join(", ");
}
