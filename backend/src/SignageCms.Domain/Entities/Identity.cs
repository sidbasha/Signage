using SignageCms.Domain.Common;

namespace SignageCms.Domain.Entities;

public class User : TenantEntity
{
    public string Email { get; set; } = "";
    public string FullName { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public DateTime? LastLoginAt { get; set; }
    public Organization? Organization { get; set; }
    public ICollection<UserRole> UserRoles { get; set; } = new List<UserRole>();
}

/// <summary>Roles belong to an organization. System roles are seeded per organization and cannot be edited.</summary>
public class Role : TenantEntity
{
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public bool IsSystem { get; set; }
    public ICollection<RolePermission> Permissions { get; set; } = new List<RolePermission>();
    public ICollection<UserRole> UserRoles { get; set; } = new List<UserRole>();
}

public class Permission
{
    public string Code { get; set; } = "";
    public string Group { get; set; } = "";
    public string Description { get; set; } = "";
}

public class RolePermission
{
    public Guid RoleId { get; set; }
    public Role? Role { get; set; }
    public string PermissionCode { get; set; } = "";
    public Permission? Permission { get; set; }
}

public class UserRole
{
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public Guid RoleId { get; set; }
    public Role? Role { get; set; }
}

public class RefreshToken : BaseEntity
{
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public Guid? ReplacedById { get; set; }
    public string? CreatedByIp { get; set; }
    public bool IsActive(DateTime now) => RevokedAt == null && ExpiresAt > now;
}
