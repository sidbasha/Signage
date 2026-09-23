using SignageCms.Domain.Common;
using SignageCms.Domain.Enums;

namespace SignageCms.Domain.Entities;

public class Notification : TenantEntity
{
    /// <summary>Null = visible to everyone in the organization.</summary>
    public Guid? UserId { get; set; }
    public NotificationSeverity Severity { get; set; }
    public string Category { get; set; } = "";
    public string Title { get; set; } = "";
    public string Message { get; set; } = "";
    public string? Link { get; set; }
    public bool IsRead { get; set; }
}

public class AuditLog : TenantEntity
{
    public Guid? UserId { get; set; }
    public string? UserEmail { get; set; }
    public string Action { get; set; } = "";
    public string EntityType { get; set; } = "";
    public string? EntityId { get; set; }
    public string? Summary { get; set; }
    public string? IpAddress { get; set; }
}
