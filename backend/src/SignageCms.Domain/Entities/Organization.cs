using SignageCms.Domain.Common;
using SignageCms.Domain.Enums;

namespace SignageCms.Domain.Entities;

public class Organization : BaseEntity
{
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";
    public string DefaultTimeZone { get; set; } = "UTC";
    public bool IsActive { get; set; } = true;
    public Subscription? Subscription { get; set; }
}

public class Subscription : TenantEntity
{
    public SubscriptionPlan Plan { get; set; } = SubscriptionPlan.Free;
    public SubscriptionStatus Status { get; set; } = SubscriptionStatus.Active;
    public int MaxDevices { get; set; }
    public int MaxUsers { get; set; }
    public long MaxStorageBytes { get; set; }
    public DateTime StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
}

public class Location : TenantEntity
{
    public string Name { get; set; } = "";
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? Country { get; set; }
    /// <summary>IANA time zone, e.g. "Asia/Kolkata". Used by players to evaluate schedules.</summary>
    public string TimeZone { get; set; } = "UTC";
    public ICollection<Device> Devices { get; set; } = new List<Device>();
}
