using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using SignageCms.Domain.Entities;

namespace SignageCms.Application.Common;

public interface IAppDbContext
{
    DbSet<Organization> Organizations { get; }
    DbSet<Subscription> Subscriptions { get; }
    DbSet<Location> Locations { get; }
    DbSet<User> Users { get; }
    DbSet<Role> Roles { get; }
    DbSet<Permission> Permissions { get; }
    DbSet<RolePermission> RolePermissions { get; }
    DbSet<UserRole> UserRoles { get; }
    DbSet<RefreshToken> RefreshTokens { get; }
    DbSet<Device> Devices { get; }
    DbSet<DeviceGroup> DeviceGroups { get; }
    DbSet<DeviceGroupMember> DeviceGroupMembers { get; }
    DbSet<PairingRequest> PairingRequests { get; }
    DbSet<PlaybackLog> PlaybackLogs { get; }
    DbSet<MediaAsset> MediaAssets { get; }
    DbSet<Playlist> Playlists { get; }
    DbSet<PlaylistItem> PlaylistItems { get; }
    DbSet<Layout> Layouts { get; }
    DbSet<LayoutZone> LayoutZones { get; }
    DbSet<Schedule> Schedules { get; }
    DbSet<ScheduleTarget> ScheduleTargets { get; }
    DbSet<Notification> Notifications { get; }
    DbSet<AuditLog> AuditLogs { get; }
    DatabaseFacade Database { get; }
    Task<int> SaveChangesAsync(CancellationToken ct = default);
}

/// <summary>The caller of the current request: an admin user (JWT) or a paired device (device key).</summary>
public interface ICurrentUser
{
    Guid? UserId { get; }
    Guid? OrganizationId { get; }
    Guid? DeviceId { get; }
    string? Email { get; }
    string? IpAddress { get; }
    bool HasPermission(string permission);
}

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string hash, string password);
}

public record AccessToken(string Token, DateTime ExpiresAt);

public interface ITokenService
{
    AccessToken CreateAccessToken(User user, string organizationName, IEnumerable<string> roles, IEnumerable<string> permissions);
}

public record StoredFile(string Key, long SizeBytes, string Sha256);

public interface IFileStorage
{
    Task<StoredFile> SaveAsync(Stream content, string key, CancellationToken ct);
    string GetPhysicalPath(string key);
    Task DeleteAsync(string key);
}

/// <summary>Short-lived HMAC-signed URLs for media so &lt;img&gt;/&lt;video&gt; tags and players can fetch files without headers.</summary>
public interface IUrlSigner
{
    string SignMediaUrl(Guid mediaId, TimeSpan lifetime);
    bool Validate(Guid mediaId, long expiresUnix, string signature);
}

/// <summary>Real-time push channel (SignalR in the API layer).</summary>
public interface IRealtimeNotifier
{
    Task ContentChangedAsync(Guid organizationId);
    Task DeviceStatusChangedAsync(Guid organizationId, object payload);
    Task NotificationCreatedAsync(Guid organizationId, object payload);
    Task SendDeviceCommandAsync(Guid deviceId, string command, object? payload = null);
    Task DeviceRevokedAsync(Guid deviceId);
}

public interface IClock { DateTime UtcNow { get; } }

public class SystemClock : IClock { public DateTime UtcNow => DateTime.UtcNow; }
