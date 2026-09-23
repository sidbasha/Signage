using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Common;
using SignageCms.Domain.Entities;

namespace SignageCms.Infrastructure.Persistence;

public class AppDbContext : DbContext, IAppDbContext
{
    private readonly ICurrentUser? _currentUser;
    private readonly IClock? _clock;

    public AppDbContext(DbContextOptions<AppDbContext> options, ICurrentUser? currentUser = null, IClock? clock = null) : base(options)
    {
        _currentUser = currentUser; _clock = clock;
    }

    /// <summary>Evaluated per query by the global tenant filters. Null matches nothing (secure default).</summary>
    public Guid? CurrentOrganizationId => _currentUser?.OrganizationId;

    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<Location> Locations => Set<Location>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<Permission> Permissions => Set<Permission>();
    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
    public DbSet<UserRole> UserRoles => Set<UserRole>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<DeviceGroup> DeviceGroups => Set<DeviceGroup>();
    public DbSet<DeviceGroupMember> DeviceGroupMembers => Set<DeviceGroupMember>();
    public DbSet<PairingRequest> PairingRequests => Set<PairingRequest>();
    public DbSet<PlaybackLog> PlaybackLogs => Set<PlaybackLog>();
    public DbSet<MediaAsset> MediaAssets => Set<MediaAsset>();
    public DbSet<Playlist> Playlists => Set<Playlist>();
    public DbSet<PlaylistItem> PlaylistItems => Set<PlaylistItem>();
    public DbSet<Layout> Layouts => Set<Layout>();
    public DbSet<LayoutZone> LayoutZones => Set<LayoutZone>();
    public DbSet<Schedule> Schedules => Set<Schedule>();
    public DbSet<ScheduleTarget> ScheduleTargets => Set<ScheduleTarget>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

        foreach (var et in b.Model.GetEntityTypes())
        {
            var clr = et.ClrType;
            // Ids are generated client-side; tell EF so new children found via navigations are inserted, not updated.
            if (typeof(BaseEntity).IsAssignableFrom(clr)) b.Entity(clr).Property(nameof(BaseEntity.Id)).ValueGeneratedNever();
            // Enums as strings: readable, and new device types need no data migration.
            foreach (var p in et.GetProperties().Where(p => (Nullable.GetUnderlyingType(p.ClrType) ?? p.ClrType).IsEnum))
                p.SetProviderClrType(typeof(string));
            if (typeof(ITenantEntity).IsAssignableFrom(clr))
            {
                b.Entity(clr).HasIndex(nameof(ITenantEntity.OrganizationId));
                b.Entity(clr).HasQueryFilter(TenantFilter(clr));
            }
        }
        // Children without their own OrganizationId inherit isolation through their parent.
        b.Entity<RolePermission>().HasQueryFilter(x => x.Role!.OrganizationId == CurrentOrganizationId);
        b.Entity<UserRole>().HasQueryFilter(x => x.User!.OrganizationId == CurrentOrganizationId);
        b.Entity<DeviceGroupMember>().HasQueryFilter(x => x.Device!.OrganizationId == CurrentOrganizationId);
        b.Entity<PlaylistItem>().HasQueryFilter(x => x.Playlist!.OrganizationId == CurrentOrganizationId);
        b.Entity<LayoutZone>().HasQueryFilter(x => x.Layout!.OrganizationId == CurrentOrganizationId);
        b.Entity<ScheduleTarget>().HasQueryFilter(x => x.Schedule!.OrganizationId == CurrentOrganizationId);
        b.Entity<RefreshToken>().HasQueryFilter(x => x.User!.OrganizationId == CurrentOrganizationId);
    }

    private LambdaExpression TenantFilter(Type clr)
    {
        var p = Expression.Parameter(clr, "e");
        var orgProp = Expression.Convert(Expression.Property(p, nameof(ITenantEntity.OrganizationId)), typeof(Guid?));
        var current = Expression.Property(Expression.Constant(this), nameof(CurrentOrganizationId));
        return Expression.Lambda(Expression.Equal(orgProp, current), p);
    }

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        var now = _clock?.UtcNow ?? DateTime.UtcNow;
        var org = CurrentOrganizationId;
        foreach (var e in ChangeTracker.Entries())
        {
            if (e.Entity is BaseEntity be)
            {
                if (e.State == EntityState.Added) { if (be.CreatedAt == default) be.CreatedAt = now; be.UpdatedAt = now; }
                else if (e.State == EntityState.Modified && be.UpdatedAt < now.AddSeconds(-1)) be.UpdatedAt = now;
            }
            if (e.Entity is ITenantEntity te && e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            {
                if (e.State == EntityState.Added && te.OrganizationId == Guid.Empty)
                    te.OrganizationId = org ?? throw new InvalidOperationException($"Cannot create {e.Entity.GetType().Name} without an organization context.");
                // Defence in depth: never write another tenant's rows from a tenant-scoped request.
                if (org != null && te.OrganizationId != org)
                    throw new InvalidOperationException($"Cross-tenant write blocked on {e.Entity.GetType().Name}.");
            }
        }
        return base.SaveChangesAsync(ct);
    }
}
