using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;
using SignageCms.Domain.Enums;

namespace SignageCms.Application.Services;

public record DeviceDto(Guid Id, string Name, string Type, string Status, string Orientation, Guid? LocationId, string? LocationName,
    Guid? DefaultPlaylistId, string? DefaultPlaylistName, string? HardwareId, string? Resolution, string? AppVersion, string? OsVersion, string? IpAddress,
    DateTime PairedAt, DateTime? LastSeenAt, DateTime? LastSyncAt, string? SyncedVersion, string? CurrentItem, long? FreeStorageBytes, RoleRef[] Groups);
public record PairDeviceRequest(string Code, string Name, Guid? LocationId, Guid? DefaultPlaylistId, Guid[]? GroupIds, string? Orientation);
public record UpdateDeviceRequest(string Name, Guid? LocationId, Guid? DefaultPlaylistId, Guid[]? GroupIds, string Orientation);
public record DeviceCommandRequest(string Command);

public class DeviceService
{
    public static readonly string[] Commands = { "refresh", "reload", "identify", "clear-cache" };
    private readonly IAppDbContext _db; private readonly AuditService _audit; private readonly IRealtimeNotifier _rt;
    private readonly NotificationService _notifications; private readonly IClock _clock; private readonly ICurrentUser _me;
    public DeviceService(IAppDbContext db, AuditService audit, IRealtimeNotifier rt, NotificationService notifications, IClock clock, ICurrentUser me)
    { _db = db; _audit = audit; _rt = rt; _notifications = notifications; _clock = clock; _me = me; }

    private IQueryable<Device> Query() => _db.Devices.Include(d => d.Location).Include(d => d.DefaultPlaylist).Include(d => d.Groups).ThenInclude(g => g.DeviceGroup);

    public static DeviceDto ToDto(Device d) => new(d.Id, d.Name, d.Type.ToString(), d.Status.ToString(), d.Orientation.ToString(), d.LocationId, d.Location?.Name,
        d.DefaultPlaylistId, d.DefaultPlaylist?.Name, d.HardwareId, d.Resolution, d.AppVersion, d.OsVersion, d.IpAddress, d.PairedAt, d.LastSeenAt, d.LastSyncAt,
        d.SyncedVersion, d.CurrentItem, d.FreeStorageBytes, d.Groups.Select(g => new RoleRef(g.DeviceGroupId, g.DeviceGroup?.Name ?? "")).OrderBy(g => g.Name).ToArray());

    public async Task<List<DeviceDto>> ListAsync(Guid? locationId, Guid? groupId, string? status, CancellationToken ct)
    {
        var q = Query().AsNoTracking().AsSplitQuery();
        if (locationId != null) q = q.Where(d => d.LocationId == locationId);
        if (groupId != null) q = q.Where(d => d.Groups.Any(g => g.DeviceGroupId == groupId));
        if (Enum.TryParse<DeviceStatus>(status, true, out var s)) q = q.Where(d => d.Status == s);
        return (await q.OrderBy(d => d.Name).ToListAsync(ct)).Select(ToDto).ToList();
    }

    public async Task<DeviceDto> GetAsync(Guid id, CancellationToken ct) =>
        ToDto(await Query().AsNoTracking().AsSplitQuery().FirstOrDefaultAsync(d => d.Id == id, ct) ?? throw new NotFoundException("Device", id));

    private async Task ValidateRefsAsync(Validator v, Guid? locationId, Guid? playlistId, Guid[]? groupIds, CancellationToken ct)
    {
        if (locationId != null) v.Check(await _db.Locations.AnyAsync(l => l.Id == locationId, ct), "locationId", "Location not found.");
        if (playlistId != null) v.Check(await _db.Playlists.AnyAsync(p => p.Id == playlistId, ct), "defaultPlaylistId", "Playlist not found.");
        var g = (groupIds ?? Array.Empty<Guid>()).Distinct().ToList();
        v.Check(await _db.DeviceGroups.CountAsync(x => g.Contains(x.Id), ct) == g.Count, "groupIds", "A selected group no longer exists.");
    }

    /// <summary>Claims a pairing code shown on a player and binds the device to the caller's organization.</summary>
    public async Task<DeviceDto> PairAsync(PairDeviceRequest r, CancellationToken ct)
    {
        var v = new Validator().Require("code", r.Code, 12).Require("name", r.Name, 120);
        var orientation = Orientation.Landscape;
        v.Check(r.Orientation == null || Enum.TryParse(r.Orientation, true, out orientation), "orientation", "Orientation must be Landscape or Portrait.");
        await ValidateRefsAsync(v, r.LocationId, r.DefaultPlaylistId, r.GroupIds, ct);
        v.ThrowIfInvalid();

        var code = r.Code.Trim().ToUpperInvariant().Replace("-", "").Replace(" ", "");
        var now = _clock.UtcNow;
        var req = await _db.PairingRequests.FirstOrDefaultAsync(p => p.Code == code && p.Status == PairingStatus.Pending && p.ExpiresAt > now, ct)
                  ?? throw new ValidationException("code", "That code is invalid or has expired. Check the code on the screen and try again.");

        var sub = await _db.Subscriptions.AsNoTracking().FirstAsync(ct);
        if (await _db.Devices.CountAsync(ct) >= sub.MaxDevices)
            throw new QuotaExceededException($"Your {sub.Plan} plan allows {sub.MaxDevices} devices. Upgrade the plan to pair more screens.");

        var key = Crypto.RandomToken(32);
        var device = new Device
        {
            Name = r.Name.Trim(), Type = req.DeviceType, Orientation = orientation, LocationId = r.LocationId, DefaultPlaylistId = r.DefaultPlaylistId,
            DeviceKeyHash = Crypto.Sha256(key), HardwareId = req.HardwareId, Resolution = req.Resolution, AppVersion = req.AppVersion,
            OsVersion = req.OsVersion, IpAddress = req.IpAddress, PairedAt = now,
        };
        foreach (var g in (r.GroupIds ?? Array.Empty<Guid>()).Distinct()) device.Groups.Add(new DeviceGroupMember { DeviceId = device.Id, DeviceGroupId = g });
        _db.Devices.Add(device);
        req.Status = PairingStatus.Paired; req.OrganizationId = device.OrganizationId = _me.OrganizationId!.Value; req.DeviceId = device.Id; req.PendingDeviceKey = key;
        _audit.Record("device.paired", "Device", device.Id, $"Paired {device.Type} '{device.Name}'");
        var n = _notifications.Add(device.OrganizationId, NotificationSeverity.Success, "device", "Device paired", $"{device.Name} is paired and will start playing shortly.", $"/devices/{device.Id}");
        await _db.SaveChangesAsync(ct);
        await _notifications.PublishAsync(n);
        return await GetAsync(device.Id, ct);
    }

    public async Task<DeviceDto> UpdateAsync(Guid id, UpdateDeviceRequest r, CancellationToken ct)
    {
        var v = new Validator().Require("name", r.Name, 120);
        v.Check(Enum.TryParse<Orientation>(r.Orientation, true, out var orientation), "orientation", "Orientation must be Landscape or Portrait.");
        await ValidateRefsAsync(v, r.LocationId, r.DefaultPlaylistId, r.GroupIds, ct);
        v.ThrowIfInvalid();
        var d = await _db.Devices.Include(x => x.Groups).FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Device", id);
        d.Name = r.Name.Trim(); d.LocationId = r.LocationId; d.DefaultPlaylistId = r.DefaultPlaylistId; d.Orientation = orientation;
        var groups = (r.GroupIds ?? Array.Empty<Guid>()).Distinct().ToList();
        _db.DeviceGroupMembers.RemoveRange(d.Groups.Where(g => !groups.Contains(g.DeviceGroupId)));
        foreach (var g in groups.Where(g => d.Groups.All(x => x.DeviceGroupId != g))) _db.DeviceGroupMembers.Add(new DeviceGroupMember { DeviceId = id, DeviceGroupId = g });
        _audit.Record("device.updated", "Device", id, $"Updated device {d.Name}");
        await _db.SaveChangesAsync(ct);
        await _rt.ContentChangedAsync(d.OrganizationId);
        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var d = await _db.Devices.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Device", id);
        _db.Devices.Remove(d);
        _audit.Record("device.removed", "Device", id, $"Unpaired and removed {d.Name}");
        await _db.SaveChangesAsync(ct);
        await _rt.DeviceRevokedAsync(id);
    }

    public async Task SendCommandAsync(Guid id, DeviceCommandRequest r, CancellationToken ct)
    {
        if (!Commands.Contains(r.Command)) throw new ValidationException("command", $"Command must be one of: {string.Join(", ", Commands)}.");
        var d = await _db.Devices.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Device", id);
        _audit.Record("device.command", "Device", id, $"Sent '{r.Command}' to {d.Name}");
        await _db.SaveChangesAsync(ct);
        await _rt.SendDeviceCommandAsync(id, r.Command);
    }

    public async Task<object> PlaybackAsync(Guid id, int days, CancellationToken ct)
    {
        var since = _clock.UtcNow.AddDays(-Math.Clamp(days, 1, 90));
        var rows = await _db.PlaybackLogs.AsNoTracking().Where(p => p.DeviceId == id && p.PlayedAt >= since)
            .GroupBy(p => p.MediaAssetId)
            .Select(g => new { mediaAssetId = g.Key, plays = g.Count(), seconds = g.Sum(x => x.DurationSeconds), lastPlayedAt = g.Max(x => x.PlayedAt) })
            .OrderByDescending(x => x.plays).Take(50).ToListAsync(ct);
        var ids = rows.Where(r => r.mediaAssetId != null).Select(r => r.mediaAssetId!.Value).ToList();
        var names = await _db.MediaAssets.Where(m => ids.Contains(m.Id)).ToDictionaryAsync(m => m.Id, m => m.Name, ct);
        return rows.Select(r => new { r.mediaAssetId, name = r.mediaAssetId != null && names.TryGetValue(r.mediaAssetId.Value, out var n) ? n : "(deleted)", r.plays, r.seconds, r.lastPlayedAt });
    }
}
