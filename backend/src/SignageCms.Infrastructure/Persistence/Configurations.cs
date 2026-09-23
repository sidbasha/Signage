using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SignageCms.Domain.Entities;

namespace SignageCms.Infrastructure.Persistence;

public class OrganizationConfig : IEntityTypeConfiguration<Organization>
{
    public void Configure(EntityTypeBuilder<Organization> b)
    {
        b.Property(x => x.Name).HasMaxLength(120).IsRequired();
        b.Property(x => x.Slug).HasMaxLength(60).IsRequired();
        b.HasIndex(x => x.Slug).IsUnique();
        b.Property(x => x.DefaultTimeZone).HasMaxLength(64);
        b.HasOne(x => x.Subscription).WithOne().HasForeignKey<Subscription>(s => s.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class SubscriptionConfig : IEntityTypeConfiguration<Subscription>
{
    public void Configure(EntityTypeBuilder<Subscription> b) => b.Property(x => x.Plan).HasMaxLength(20);
}
public class LocationConfig : IEntityTypeConfiguration<Location>
{
    public void Configure(EntityTypeBuilder<Location> b)
    {
        b.Property(x => x.Name).HasMaxLength(120).IsRequired();
        b.Property(x => x.TimeZone).HasMaxLength(64);
        b.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class UserConfig : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> b)
    {
        b.Property(x => x.Email).HasMaxLength(200).IsRequired();
        b.HasIndex(x => x.Email).IsUnique();
        b.Property(x => x.FullName).HasMaxLength(120);
        b.HasOne(x => x.Organization).WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class RoleConfig : IEntityTypeConfiguration<Role>
{
    public void Configure(EntityTypeBuilder<Role> b)
    {
        b.Property(x => x.Name).HasMaxLength(60).IsRequired();
        b.HasIndex(x => new { x.OrganizationId, x.Name }).IsUnique();
        b.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class PermissionConfig : IEntityTypeConfiguration<Permission>
{
    public void Configure(EntityTypeBuilder<Permission> b) { b.HasKey(x => x.Code); b.Property(x => x.Code).HasMaxLength(60); }
}
public class RolePermissionConfig : IEntityTypeConfiguration<RolePermission>
{
    public void Configure(EntityTypeBuilder<RolePermission> b)
    {
        b.HasKey(x => new { x.RoleId, x.PermissionCode });
        b.HasOne(x => x.Role).WithMany(r => r.Permissions).HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Permission).WithMany().HasForeignKey(x => x.PermissionCode).OnDelete(DeleteBehavior.Cascade);
    }
}
public class UserRoleConfig : IEntityTypeConfiguration<UserRole>
{
    public void Configure(EntityTypeBuilder<UserRole> b)
    {
        b.HasKey(x => new { x.UserId, x.RoleId });
        b.HasOne(x => x.User).WithMany(u => u.UserRoles).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Role).WithMany(r => r.UserRoles).HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Restrict);
    }
}
public class RefreshTokenConfig : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> b)
    {
        b.Property(x => x.TokenHash).HasMaxLength(64).IsRequired();
        b.HasIndex(x => x.TokenHash).IsUnique();
        b.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class DeviceConfig : IEntityTypeConfiguration<Device>
{
    public void Configure(EntityTypeBuilder<Device> b)
    {
        b.Property(x => x.Name).HasMaxLength(120).IsRequired();
        b.Property(x => x.Type).HasMaxLength(30);
        b.Property(x => x.Status).HasMaxLength(20);
        b.Property(x => x.Orientation).HasMaxLength(20);
        b.Property(x => x.DeviceKeyHash).HasMaxLength(64).IsRequired();
        b.HasIndex(x => x.DeviceKeyHash).IsUnique();
        b.HasIndex(x => new { x.Status, x.LastSeenAt });
        b.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Location).WithMany(l => l.Devices).HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.SetNull);
        b.HasOne(x => x.DefaultPlaylist).WithMany().HasForeignKey(x => x.DefaultPlaylistId).OnDelete(DeleteBehavior.SetNull);
    }
}
public class DeviceGroupConfig : IEntityTypeConfiguration<DeviceGroup>
{
    public void Configure(EntityTypeBuilder<DeviceGroup> b)
    {
        b.Property(x => x.Name).HasMaxLength(120).IsRequired();
        b.HasIndex(x => new { x.OrganizationId, x.Name }).IsUnique();
        b.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.DefaultPlaylist).WithMany().HasForeignKey(x => x.DefaultPlaylistId).OnDelete(DeleteBehavior.SetNull);
    }
}
public class DeviceGroupMemberConfig : IEntityTypeConfiguration<DeviceGroupMember>
{
    public void Configure(EntityTypeBuilder<DeviceGroupMember> b)
    {
        b.HasKey(x => new { x.DeviceGroupId, x.DeviceId });
        b.HasOne(x => x.DeviceGroup).WithMany(g => g.Members).HasForeignKey(x => x.DeviceGroupId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Device).WithMany(d => d.Groups).HasForeignKey(x => x.DeviceId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class PairingRequestConfig : IEntityTypeConfiguration<PairingRequest>
{
    public void Configure(EntityTypeBuilder<PairingRequest> b)
    {
        b.Property(x => x.Code).HasMaxLength(12).IsRequired();
        b.HasIndex(x => new { x.Code, x.Status });
        b.Property(x => x.Status).HasMaxLength(20);
        b.Property(x => x.DeviceType).HasMaxLength(30);
    }
}
public class PlaybackLogConfig : IEntityTypeConfiguration<PlaybackLog>
{
    public void Configure(EntityTypeBuilder<PlaybackLog> b)
    {
        b.HasIndex(x => new { x.DeviceId, x.PlayedAt });
        b.HasOne<Device>().WithMany().HasForeignKey(x => x.DeviceId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class MediaAssetConfig : IEntityTypeConfiguration<MediaAsset>
{
    public void Configure(EntityTypeBuilder<MediaAsset> b)
    {
        b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.Property(x => x.Type).HasMaxLength(20);
        b.Property(x => x.StorageKey).HasMaxLength(300);
        b.Property(x => x.Sha256).HasMaxLength(64);
        b.Property(x => x.Url).HasMaxLength(2000);
        b.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class PlaylistConfig : IEntityTypeConfiguration<Playlist>
{
    public void Configure(EntityTypeBuilder<Playlist> b)
    {
        b.Property(x => x.Name).HasMaxLength(120).IsRequired();
        b.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class PlaylistItemConfig : IEntityTypeConfiguration<PlaylistItem>
{
    public void Configure(EntityTypeBuilder<PlaylistItem> b)
    {
        b.HasIndex(x => new { x.PlaylistId, x.SortOrder });
        b.Property(x => x.Transition).HasMaxLength(20);
        b.HasOne(x => x.Playlist).WithMany(p => p.Items).HasForeignKey(x => x.PlaylistId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.MediaAsset).WithMany().HasForeignKey(x => x.MediaAssetId).OnDelete(DeleteBehavior.Restrict);
    }
}
public class LayoutConfig : IEntityTypeConfiguration<Layout>
{
    public void Configure(EntityTypeBuilder<Layout> b)
    {
        b.Property(x => x.Name).HasMaxLength(120).IsRequired();
        b.Property(x => x.Orientation).HasMaxLength(20);
        b.Property(x => x.BackgroundColor).HasMaxLength(7);
        b.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class LayoutZoneConfig : IEntityTypeConfiguration<LayoutZone>
{
    public void Configure(EntityTypeBuilder<LayoutZone> b)
    {
        b.Property(x => x.Name).HasMaxLength(60);
        b.HasOne(x => x.Layout).WithMany(l => l.Zones).HasForeignKey(x => x.LayoutId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Playlist).WithMany().HasForeignKey(x => x.PlaylistId).OnDelete(DeleteBehavior.SetNull);
    }
}
public class ScheduleConfig : IEntityTypeConfiguration<Schedule>
{
    public void Configure(EntityTypeBuilder<Schedule> b)
    {
        b.Property(x => x.Name).HasMaxLength(120).IsRequired();
        b.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Layout).WithMany().HasForeignKey(x => x.LayoutId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Playlist).WithMany().HasForeignKey(x => x.PlaylistId).OnDelete(DeleteBehavior.Restrict);
        b.ToTable(t => t.HasCheckConstraint("CK_Schedule_Content", "(\"LayoutId\" IS NULL) <> (\"PlaylistId\" IS NULL)"));
    }
}
public class ScheduleTargetConfig : IEntityTypeConfiguration<ScheduleTarget>
{
    public void Configure(EntityTypeBuilder<ScheduleTarget> b)
    {
        b.HasOne(x => x.Schedule).WithMany(s => s.Targets).HasForeignKey(x => x.ScheduleId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Device).WithMany().HasForeignKey(x => x.DeviceId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.DeviceGroup).WithMany().HasForeignKey(x => x.DeviceGroupId).OnDelete(DeleteBehavior.Cascade);
        b.ToTable(t => t.HasCheckConstraint("CK_ScheduleTarget_One", "(\"DeviceId\" IS NULL) <> (\"DeviceGroupId\" IS NULL)"));
    }
}
public class NotificationConfig : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> b)
    {
        b.Property(x => x.Severity).HasMaxLength(20);
        b.Property(x => x.Title).HasMaxLength(200);
        b.HasIndex(x => new { x.OrganizationId, x.IsRead, x.CreatedAt });
        b.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class AuditLogConfig : IEntityTypeConfiguration<AuditLog>
{
    public void Configure(EntityTypeBuilder<AuditLog> b)
    {
        b.Property(x => x.Action).HasMaxLength(60);
        b.Property(x => x.EntityType).HasMaxLength(60);
        b.HasIndex(x => new { x.OrganizationId, x.CreatedAt });
        b.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}
