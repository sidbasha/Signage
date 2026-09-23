using SignageCms.Domain.Entities;
using SignageCms.Domain.Enums;

namespace SignageCms.Application.Common;

public record PlanLimits(SubscriptionPlan Plan, int MaxDevices, int MaxUsers, long MaxStorageBytes, decimal MonthlyPricePerScreen);

public static class Plans
{
    private const long GB = 1024L * 1024 * 1024;
    public static readonly PlanLimits[] All =
    {
        new(SubscriptionPlan.Free, 3, 3, 2 * GB, 0),
        new(SubscriptionPlan.Pro, 100, 25, 100 * GB, 12),
        new(SubscriptionPlan.Enterprise, 10000, 1000, 2000 * GB, 20),
    };
    public static PlanLimits For(SubscriptionPlan plan) => All.First(p => p.Plan == plan);

    public static void Apply(Subscription s, SubscriptionPlan plan)
    {
        var l = For(plan);
        s.Plan = plan; s.MaxDevices = l.MaxDevices; s.MaxUsers = l.MaxUsers; s.MaxStorageBytes = l.MaxStorageBytes;
    }
}
