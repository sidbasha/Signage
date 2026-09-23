namespace SignageCms.Domain.Common;

public abstract class BaseEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Entity owned by exactly one organization (tenant). Enforced by global query filters.</summary>
public interface ITenantEntity
{
    Guid OrganizationId { get; set; }
}

public abstract class TenantEntity : BaseEntity, ITenantEntity
{
    public Guid OrganizationId { get; set; }
}
