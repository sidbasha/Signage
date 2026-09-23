using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;
using SignageCms.Domain.Enums;

namespace SignageCms.Application.Services;

public record ManifestMedia(Guid Id, string Name, string Type, string? MimeType, string? Sha256, long SizeBytes, int DurationSeconds, string? Url, string? SourceUrl);
public record ManifestPlaylistItem(Guid MediaId, int DurationSeconds, string Transition);
public record ManifestPlaylist(Guid Id, string Name, bool Shuffle, ManifestPlaylistItem[] Items);
public record ManifestZone(Guid Id, string Name, double X, double Y, double Width, double Height, int ZIndex, Guid? PlaylistId);
public record ManifestLayout(Guid Id, string Name, int Width, int Height, string BackgroundColor, ManifestZone[] Zones);
public record ManifestSchedule(Guid Id, string Name, int Priority, Guid? LayoutId, Guid? PlaylistId, string StartDate, string? EndDate, string? StartTime, string? EndTime, int DaysOfWeek);
public record ManifestDevice(Guid Id, string Name, string Orientation, string TimeZone, string OrganizationName);
/// <summary>
/// Everything a player needs to run offline. Schedules are evaluated on the device in its time zone,
/// so a player keeps switching content correctly even when disconnected.
/// </summary>
public record DeviceManifest(string Version, DateTime GeneratedAt, ManifestDevice Device, Guid? DefaultPlaylistId,
    ManifestSchedule[] Schedules, ManifestLayout[] Layouts, ManifestPlaylist[] Playlists, ManifestMedia[] Media);

public record HeartbeatRequest(string? AppVersion, string? OsVersion, string? Resolution, string? SyncedVersion, string? CurrentItem, long? FreeStorageBytes);
public record PlaybackEntry(Guid? MediaId, Guid? PlaylistId, DateTime PlayedAt, int DurationSeconds);

public class DeviceSyncService
{
    public static readonly TimeSpan OfflineAfter = TimeSpan.FromSeconds(90);
    private readonly IAppDbContext _db; private readonly ICurrentUser _caller; private readonly IUrlSigner _signer;
    private readonly IClock _clock; private readonly IRealtimeNotifier _rt; private readonly NotificationService _notifications;
    public DeviceSyncService(IAppDbContext db, ICurrentUser caller, IUrlSigner signer, IClock clock, IRealtimeNotifier rt, NotificationService notifications)
    { _db = db; _caller = caller; _signer = signer; _clock = clock; _rt = rt; _notifications = notifications; }

    private Guid DeviceId => _caller.DeviceId ?? throw new UnauthorizedException("Device credentials required.");

    public async Task<DeviceManifest> BuildManifestAsync(CancellationToken ct)
    {
        var device = await _db.Devices.Include(d => d.Location).Include(d => d.Groups).ThenInclude(g => g.DeviceGroup)
            .AsNoTracking().FirstOrDefaultAsync(d => d.Id == DeviceId, ct) ?? throw new UnauthorizedException("Device was removed.");
        var org = await _db.Organizations.AsNoTracking().FirstAsync(o => o.Id == device.OrganizationId, ct);
        var groupIds = device.Groups.Select(g => g.DeviceGroupId).ToList();
        var yesterday = DateOnly.FromDateTime(_clock.UtcNow).AddDays(-1);

        var schedules = await _db.Schedules.AsNoTracking()
            .Where(s => s.IsActive && (s.EndDate == null || s.EndDate >= yesterday)
                        && s.Targets.Any(t => t.DeviceId == device.Id || (t.DeviceGroupId != null && groupIds.Contains(t.DeviceGroupId.Value))))
            .OrderByDescending(s => s.Priority).ThenBy(s => s.Id).ToListAsync(ct);

        var defaultPlaylistId = device.DefaultPlaylistId
            ?? device.Groups.OrderBy(g => g.DeviceGroup!.Name).Select(g => g.DeviceGroup!.DefaultPlaylistId).FirstOrDefault(p => p != null);

        var layoutIds = schedules.Where(s => s.LayoutId != null).Select(s => s.LayoutId!.Value).Distinct().ToList();
        var layouts = await _db.Layouts.AsNoTracking().Include(l => l.Zones).Where(l => layoutIds.Contains(l.Id)).OrderBy(l => l.Id).ToListAsync(ct);

        var playlistIds = schedules.Where(s => s.PlaylistId != null).Select(s => s.PlaylistId!.Value)
            .Concat(layouts.SelectMany(l => l.Zones).Where(z => z.PlaylistId != null).Select(z => z.PlaylistId!.Value))
            .Concat(defaultPlaylistId != null ? new[] { defaultPlaylistId.Value } : Array.Empty<Guid>()).Distinct().ToList();
        var playlists = await _db.Playlists.AsNoTracking().Include(p => p.Items).Where(p => playlistIds.Contains(p.Id)).OrderBy(p => p.Id).ToListAsync(ct);

        var mediaIds = playlists.SelectMany(p => p.Items).Select(i => i.MediaAssetId).Distinct().ToList();
        var media = await _db.MediaAssets.AsNoTracking().Where(m => mediaIds.Contains(m.Id)).OrderBy(m => m.Id).ToListAsync(ct);
        var mediaById = media.ToDictionary(m => m.Id);

        var tz = device.Location?.TimeZone ?? org.DefaultTimeZone;
        var mDevice = new ManifestDevice(device.Id, device.Name, device.Orientation.ToString(), tz, org.Name);
        var mSchedules = schedules.Select(s => new ManifestSchedule(s.Id, s.Name, s.Priority, s.LayoutId, s.PlaylistId, s.StartDate.ToString("yyyy-MM-dd"),
            s.EndDate?.ToString("yyyy-MM-dd"), s.StartTime?.ToString("HH:mm"), s.EndTime?.ToString("HH:mm"), s.DaysOfWeek)).ToArray();
        var mLayouts = layouts.Select(l => new ManifestLayout(l.Id, l.Name, l.Width, l.Height, l.BackgroundColor,
            l.Zones.OrderBy(z => z.ZIndex).ThenBy(z => z.Id).Select(z => new ManifestZone(z.Id, z.Name, z.X, z.Y, z.Width, z.Height, z.ZIndex, z.PlaylistId)).ToArray())).ToArray();
        var mPlaylists = playlists.Select(p => new ManifestPlaylist(p.Id, p.Name, p.Shuffle,
            p.Items.OrderBy(i => i.SortOrder).Where(i => mediaById.ContainsKey(i.MediaAssetId))
                .Select(i => new ManifestPlaylistItem(i.MediaAssetId, i.DurationSeconds ?? mediaById[i.MediaAssetId].DurationSeconds, i.Transition)).ToArray())).ToArray();
        var mMediaUnsigned = media.Select(m => new ManifestMedia(m.Id, m.Name, m.Type.ToString(), m.MimeType, m.Sha256, m.SizeBytes, m.DurationSeconds, null,
            m.Type == MediaType.Web ? m.Url : null)).ToArray();

        // Version = hash of content only (signed URLs change every call and must not change the version).
        var version = Crypto.Sha256(JsonSerializer.Serialize(new { mDevice, defaultPlaylistId, mSchedules, mLayouts, mPlaylists, mMediaUnsigned }))[..16];
        var mMedia = mMediaUnsigned.Select(m => m.Type == nameof(MediaType.Web) ? m : m with { Url = _signer.SignMediaUrl(m.Id, TimeSpan.FromDays(7)) }).ToArray();
        return new DeviceManifest(version, _clock.UtcNow, mDevice, defaultPlaylistId, mSchedules, mLayouts, mPlaylists, mMedia);
    }

    /// <summary>Records that the device fetched the manifest.</summary>
    public async Task TouchSyncAsync(CancellationToken ct)
    {
        var d = await _db.Devices.FirstOrDefaultAsync(x => x.Id == DeviceId, ct);
        if (d == null) return;
        d.LastSyncAt = _clock.UtcNow;
        await SetOnlineAsync(d, ct);
    }

    public async Task HeartbeatAsync(HeartbeatRequest r, CancellationToken ct)
    {
        var d = await _db.Devices.FirstOrDefaultAsync(x => x.Id == DeviceId, ct) ?? throw new UnauthorizedException("Device was removed.");
        d.AppVersion = r.AppVersion ?? d.AppVersion; d.OsVersion = Cut(r.OsVersion, 200) ?? d.OsVersion; d.Resolution = Cut(r.Resolution, 40) ?? d.Resolution;
        d.SyncedVersion = Cut(r.SyncedVersion, 40) ?? d.SyncedVersion; d.CurrentItem = Cut(r.CurrentItem, 200); d.FreeStorageBytes = r.FreeStorageBytes;
        d.IpAddress = _caller.IpAddress ?? d.IpAddress;
        await SetOnlineAsync(d, ct);
    }

    public async Task RecordPlaybackAsync(PlaybackEntry[] entries, CancellationToken ct)
    {
        var d = await _db.Devices.AsNoTracking().FirstOrDefaultAsync(x => x.Id == DeviceId, ct) ?? throw new UnauthorizedException("Device was removed.");
        var now = _clock.UtcNow;
        foreach (var e in (entries ?? Array.Empty<PlaybackEntry>()).Take(1000))
        {
            if (e.PlayedAt > now.AddMinutes(5) || e.PlayedAt < now.AddDays(-30)) continue; // drop clock-skewed junk
            _db.PlaybackLogs.Add(new PlaybackLog { OrganizationId = d.OrganizationId, DeviceId = d.Id, MediaAssetId = e.MediaId, PlaylistId = e.PlaylistId,
                PlayedAt = DateTime.SpecifyKind(e.PlayedAt, DateTimeKind.Utc), DurationSeconds = Math.Clamp(e.DurationSeconds, 0, 86400) });
        }
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>Called on real-time connect/disconnect.</summary>
    public async Task SetConnectedAsync(bool connected, CancellationToken ct)
    {
        var d = await _db.Devices.FirstOrDefaultAsync(x => x.Id == DeviceId, ct);
        if (d == null) return;
        if (connected) { try { await SetOnlineAsync(d, ct); } catch (UnauthorizedException) { } }
        else await SetOfflineAsync(d, "lost its connection", ct);
    }

    private async Task SetOnlineAsync(Device d, CancellationToken ct)
    {
        var wasOffline = d.Status != DeviceStatus.Online;
        d.Status = DeviceStatus.Online; d.LastSeenAt = _clock.UtcNow;
        Notification? n = null;
        if (wasOffline && d.LastSeenAt != null && d.PairedAt < _clock.UtcNow.AddMinutes(-1))
            n = _notifications.Add(d.OrganizationId, NotificationSeverity.Success, "device", "Device back online", $"{d.Name} is online again.", $"/devices/{d.Id}");
        if (!await SaveUnlessRemovedAsync(ct)) throw new UnauthorizedException("Device was removed.");
        if (n != null) await _notifications.PublishAsync(n);
        await _rt.DeviceStatusChangedAsync(d.OrganizationId, Status(d));
    }

    private async Task SetOfflineAsync(Device d, string reason, CancellationToken ct)
    {
        if (d.Status == DeviceStatus.Offline) return;
        d.Status = DeviceStatus.Offline;
        var n = _notifications.Add(d.OrganizationId, NotificationSeverity.Warning, "device", "Device offline", $"{d.Name} {reason}.", $"/devices/{d.Id}");
        if (!await SaveUnlessRemovedAsync(ct)) return;
        await _notifications.PublishAsync(n);
        await _rt.DeviceStatusChangedAsync(d.OrganizationId, Status(d));
    }

    private static object Status(Device d) => new { id = d.Id, status = d.Status.ToString(), lastSeenAt = d.LastSeenAt, currentItem = d.CurrentItem, syncedVersion = d.SyncedVersion };

    /// <summary>Background sweep across all tenants: devices silent for longer than <see cref="OfflineAfter"/> go offline.</summary>
    public async Task<int> SweepStaleDevicesAsync(CancellationToken ct)
    {
        var cutoff = _clock.UtcNow - OfflineAfter;
        var stale = await _db.Devices.IgnoreQueryFilters().Where(d => d.Status == DeviceStatus.Online && (d.LastSeenAt == null || d.LastSeenAt < cutoff)).ToListAsync(ct);
        foreach (var d in stale) await SetOfflineAsync(d, "stopped reporting", ct);
        return stale.Count;
    }

    /// <summary>A device can be unpaired between loading and saving (e.g. mid-heartbeat). That's expected, not an error.</summary>
    private async Task<bool> SaveUnlessRemovedAsync(CancellationToken ct)
    {
        try { await _db.SaveChangesAsync(ct); return true; }
        catch (DbUpdateConcurrencyException) { return false; }
    }

    private static string? Cut(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];
}
