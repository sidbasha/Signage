export interface Me { id: string; email: string; fullName: string; organizationId: string; organizationName: string; roles: string[]; permissions: string[] }
export interface AuthResponse { accessToken: string; accessTokenExpiresAt: string; refreshToken: string; refreshTokenExpiresAt: string; user: Me }
export interface Ref { id: string; name: string }
export interface Location { id: string; name: string; address?: string; city?: string; country?: string; timeZone: string; deviceCount: number }
export type DeviceStatus = "Online" | "Offline";
export interface Device {
  id: string; name: string; type: string; status: DeviceStatus; orientation: "Landscape" | "Portrait"; locationId?: string; locationName?: string;
  defaultPlaylistId?: string; defaultPlaylistName?: string; hardwareId?: string; resolution?: string; appVersion?: string; osVersion?: string; ipAddress?: string;
  pairedAt: string; lastSeenAt?: string; lastSyncAt?: string; syncedVersion?: string; currentItem?: string; freeStorageBytes?: number; groups: Ref[];
}
export interface DeviceGroup { id: string; name: string; description?: string; defaultPlaylistId?: string; defaultPlaylistName?: string; devices: Ref[] }
export interface Media {
  id: string; name: string; type: "Image" | "Video" | "Web"; mimeType?: string; sizeBytes: number; sha256?: string; width?: number; height?: number;
  durationSeconds: number; url?: string; contentUrl?: string; tags?: string; createdAt: string; usedInPlaylists: number;
}
export interface PlaylistItem { id: string; mediaAssetId: string; mediaName: string; mediaType: string; sortOrder: number; durationSeconds?: number | null; effectiveDurationSeconds: number; transition: string; contentUrl?: string }
export interface Playlist { id: string; name: string; description?: string; shuffle: boolean; itemCount: number; totalDurationSeconds: number; updatedAt: string; items: PlaylistItem[] }
export interface Zone { id?: string; name: string; x: number; y: number; width: number; height: number; zIndex: number; playlistId?: string | null; playlistName?: string }
export interface Layout { id: string; name: string; description?: string; orientation: "Landscape" | "Portrait"; width: number; height: number; backgroundColor: string; isTemplate: boolean; updatedAt: string; zones: Zone[] }
export interface ScheduleTarget { deviceId?: string; deviceGroupId?: string; name: string }
export interface Schedule {
  id: string; name: string; layoutId?: string; layoutName?: string; playlistId?: string; playlistName?: string; priority: number;
  startDate: string; endDate?: string; startTime?: string; endTime?: string; daysOfWeek: number; isActive: boolean; targets: ScheduleTarget[]; updatedAt: string;
}
export interface User { id: string; email: string; fullName: string; isActive: boolean; lastLoginAt?: string; createdAt: string; roles: Ref[] }
export interface Role { id: string; name: string; description?: string; isSystem: boolean; permissions: string[]; userCount: number }
export interface Permission { code: string; group: string; description: string }
export interface Notification { id: string; createdAt: string; severity: "Info" | "Success" | "Warning" | "Error"; category: string; title: string; message: string; link?: string; isRead: boolean }
export interface AuditLog { id: string; createdAt: string; userEmail?: string; action: string; entityType: string; entityId?: string; summary?: string; ipAddress?: string }
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export interface Subscription {
  plan: string; status: string; maxDevices: number; maxUsers: number; maxStorageBytes: number; startsAt: string; endsAt?: string;
  usage: { devices: number; users: number; storageBytes: number };
  availablePlans: { plan: string; maxDevices: number; maxUsers: number; maxStorageBytes: number; monthlyPricePerScreen: number }[];
}
export interface Organization { id: string; name: string; slug: string; defaultTimeZone: string; createdAt: string }
export interface DashboardDevice { id: string; name: string; type: string; status: DeviceStatus; orientation: string; lastSeenAt?: string; currentItem?: string; location?: string }
export interface Dashboard {
  devicesTotal: number; devicesOnline: number; devicesOffline: number; mediaCount: number; storageBytes: number; playlistCount: number;
  activeSchedules: number; unreadNotifications: number; recentActivity: { id: string; createdAt: string; userEmail?: string; action: string; summary?: string }[]; devices: DashboardDevice[];
}
