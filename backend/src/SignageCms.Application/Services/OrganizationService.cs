using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Enums;

namespace SignageCms.Application.Services;

public record OrganizationDto(Guid Id, string Name, string Slug, string DefaultTimeZone, DateTime CreatedAt);
public record UpdateOrganizationRequest(string Name, string DefaultTimeZone);
public record UsageDto(int Devices, int Users, long StorageBytes);
public record SubscriptionDto(string Plan, string Status, int MaxDevices, int MaxUsers, long MaxStorageBytes, DateTime StartsAt, DateTime? EndsAt, UsageDto Usage, object[] AvailablePlans);
public record ChangePlanRequest(string Plan);
public record DashboardDto(int DevicesTotal, int DevicesOnline, int DevicesOffline, int MediaCount, long StorageBytes, int PlaylistCount, int ActiveSchedules, int UnreadNotifications, object[] RecentActivity, object[] Devices);

public class OrganizationService
{
    private readonly IAppDbContext _db; private readonly ICurrentUser _me; private readonly AuditService _audit; private readonly IRealtimeNotifier _rt;
    public OrganizationService(IAppDbContext db, ICurrentUser me, AuditService audit, IRealtimeNotifier rt) { _db = db; _me = me; _audit = audit; _rt = rt; }

    private Guid OrgId => _me.OrganizationId ?? throw new UnauthorizedException("No organization.");

    public async Task<OrganizationDto> GetAsync(CancellationToken ct)
    {
        var o = await _db.Organizations.AsNoTracking().FirstAsync(x => x.Id == OrgId, ct);
        return new(o.Id, o.Name, o.Slug, o.DefaultTimeZone, o.CreatedAt);
    }

    public async Task<OrganizationDto> UpdateAsync(UpdateOrganizationRequest r, CancellationToken ct)
    {
        var v = new Validator().Require("name", r.Name, 120); LocationService.ValidateTimeZone(v, r.DefaultTimeZone); v.ThrowIfInvalid();
        var o = await _db.Organizations.FirstAsync(x => x.Id == OrgId, ct);
        var tzChanged = o.DefaultTimeZone != r.DefaultTimeZone;
        o.Name = r.Name.Trim(); o.DefaultTimeZone = r.DefaultTimeZone;
        _audit.Record("organization.updated", "Organization", o.Id, $"Updated organization settings");
        await _db.SaveChangesAsync(ct);
        if (tzChanged) await _rt.ContentChangedAsync(o.Id);
        return await GetAsync(ct);
    }

    public async Task<UsageDto> UsageAsync(CancellationToken ct) => new(
        await _db.Devices.CountAsync(ct),
        await _db.Users.CountAsync(u => u.IsActive, ct),
        await _db.MediaAssets.SumAsync(m => (long?)m.SizeBytes, ct) ?? 0);

    public async Task<SubscriptionDto> SubscriptionAsync(CancellationToken ct)
    {
        var s = await _db.Subscriptions.AsNoTracking().FirstAsync(ct);
        return new(s.Plan.ToString(), s.Status.ToString(), s.MaxDevices, s.MaxUsers, s.MaxStorageBytes, s.StartsAt, s.EndsAt, await UsageAsync(ct),
            Plans.All.Select(p => (object)new { plan = p.Plan.ToString(), p.MaxDevices, p.MaxUsers, p.MaxStorageBytes, p.MonthlyPricePerScreen }).ToArray());
    }

    public async Task<SubscriptionDto> ChangePlanAsync(ChangePlanRequest r, CancellationToken ct)
    {
        if (!Enum.TryParse<SubscriptionPlan>(r.Plan, true, out var plan)) throw new ValidationException("plan", "Unknown plan.");
        var usage = await UsageAsync(ct);
        var limits = Plans.For(plan);
        if (usage.Devices > limits.MaxDevices || usage.Users > limits.MaxUsers || usage.StorageBytes > limits.MaxStorageBytes)
            throw new QuotaExceededException($"Current usage is above the {plan} plan limits. Remove devices, users or media first.");
        var s = await _db.Subscriptions.FirstAsync(ct);
        var old = s.Plan;
        Plans.Apply(s, plan);
        s.Status = SubscriptionStatus.Active;
        _audit.Record("subscription.changed", "Subscription", s.Id, $"Plan changed from {old} to {plan}");
        await _db.SaveChangesAsync(ct);
        return await SubscriptionAsync(ct);
    }

    public async Task<DashboardDto> DashboardAsync(CancellationToken ct)
    {
        var devices = await _db.Devices.AsNoTracking().OrderBy(d => d.Name)
            .Select(d => new { d.Id, d.Name, type = d.Type.ToString(), status = d.Status.ToString(), orientation = d.Orientation.ToString(), d.LastSeenAt, d.CurrentItem, location = d.Location != null ? d.Location.Name : null })
            .ToListAsync(ct);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var recent = await _db.AuditLogs.AsNoTracking().OrderByDescending(a => a.CreatedAt).Take(8)
            .Select(a => new { a.Id, a.CreatedAt, a.UserEmail, a.Action, a.Summary }).ToListAsync(ct);
        return new DashboardDto(
            devices.Count, devices.Count(d => d.status == "Online"), devices.Count(d => d.status != "Online"),
            await _db.MediaAssets.CountAsync(ct), await _db.MediaAssets.SumAsync(m => (long?)m.SizeBytes, ct) ?? 0,
            await _db.Playlists.CountAsync(ct),
            await _db.Schedules.CountAsync(s => s.IsActive && (s.EndDate == null || s.EndDate >= today), ct),
            await _db.Notifications.CountAsync(n => !n.IsRead && (n.UserId == null || n.UserId == _me.UserId), ct),
            recent.Cast<object>().ToArray(), devices.Cast<object>().ToArray());
    }
}
