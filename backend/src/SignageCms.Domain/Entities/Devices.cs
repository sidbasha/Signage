using SignageCms.Domain.Common;
using SignageCms.Domain.Enums;

namespace SignageCms.Domain.Entities;

public class Device : TenantEntity
{
    public string Name { get; set; } = "";
    public DeviceType Type { get; set; }
    public DeviceStatus Status { get; set; } = DeviceStatus.Offline;
    public Orientation Orientation { get; set; } = Orientation.Landscape;
    public Guid? LocationId { get; set; }
    public Location? Location { get; set; }
    /// <summary>Fallback content when no schedule is active.</summary>
    public Guid? DefaultPlaylistId { get; set; }
    public Playlist? DefaultPlaylist { get; set; }
    public string DeviceKeyHash { get; set; } = "";
    public string? HardwareId { get; set; }
    public string? Resolution { get; set; }
    public string? AppVersion { get; set; }
    public string? OsVersion { get; set; }
    public string? IpAddress { get; set; }
    public DateTime PairedAt { get; set; }
    public DateTime? LastSeenAt { get; set; }
    public DateTime? LastSyncAt { get; set; }
    /// <summary>Content version (manifest hash) the device last reported as fully cached.</summary>
    public string? SyncedVersion { get; set; }
    public string? CurrentItem { get; set; }
    public long? FreeStorageBytes { get; set; }
    public ICollection<DeviceGroupMember> Groups { get; set; } = new List<DeviceGroupMember>();
}

public class DeviceGroup : TenantEntity
{
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public Guid? DefaultPlaylistId { get; set; }
    public Playlist? DefaultPlaylist { get; set; }
    public ICollection<DeviceGroupMember> Members { get; set; } = new List<DeviceGroupMember>();
}

public class DeviceGroupMember
{
    public Guid DeviceGroupId { get; set; }
    public DeviceGroup? DeviceGroup { get; set; }
    public Guid DeviceId { get; set; }
    public Device? Device { get; set; }
}

/// <summary>
/// Created by an unpaired player. Not tenant-scoped: it only becomes bound to an organization
/// when an administrator claims the code.
/// </summary>
public class PairingRequest : BaseEntity
{
    public string Code { get; set; } = "";
    public string PollSecretHash { get; set; } = "";
    public DeviceType DeviceType { get; set; }
    public string? HardwareId { get; set; }
    public string? Resolution { get; set; }
    public string? AppVersion { get; set; }
    public string? OsVersion { get; set; }
    public string? IpAddress { get; set; }
    public DateTime ExpiresAt { get; set; }
    public PairingStatus Status { get; set; } = PairingStatus.Pending;
    public Guid? OrganizationId { get; set; }
    public Guid? DeviceId { get; set; }
    /// <summary>Plain device key held only until the player collects it once, then cleared.</summary>
    public string? PendingDeviceKey { get; set; }
}

public class PlaybackLog : TenantEntity
{
    public Guid DeviceId { get; set; }
    public Guid? MediaAssetId { get; set; }
    public Guid? PlaylistId { get; set; }
    public DateTime PlayedAt { get; set; }
    public int DurationSeconds { get; set; }
}
