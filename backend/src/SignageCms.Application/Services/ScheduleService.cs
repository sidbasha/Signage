using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;

namespace SignageCms.Application.Services;

public record ScheduleTargetDto(Guid? DeviceId, Guid? DeviceGroupId, string Name);
public record ScheduleDto(Guid Id, string Name, Guid? LayoutId, string? LayoutName, Guid? PlaylistId, string? PlaylistName, int Priority,
    DateOnly StartDate, DateOnly? EndDate, TimeOnly? StartTime, TimeOnly? EndTime, int DaysOfWeek, bool IsActive, ScheduleTargetDto[] Targets, DateTime UpdatedAt);
public record SaveScheduleRequest(string Name, Guid? LayoutId, Guid? PlaylistId, int Priority, DateOnly StartDate, DateOnly? EndDate,
    TimeOnly? StartTime, TimeOnly? EndTime, int DaysOfWeek, bool IsActive, Guid[]? DeviceIds, Guid[]? DeviceGroupIds);

public class ScheduleService
{
    private readonly IAppDbContext _db; private readonly AuditService _audit; private readonly IRealtimeNotifier _rt;
    public ScheduleService(IAppDbContext db, AuditService audit, IRealtimeNotifier rt) { _db = db; _audit = audit; _rt = rt; }

    private IQueryable<Schedule> Query() => _db.Schedules.Include(s => s.Layout).Include(s => s.Playlist)
        .Include(s => s.Targets).ThenInclude(t => t.Device).Include(s => s.Targets).ThenInclude(t => t.DeviceGroup);

    private static ScheduleDto ToDto(Schedule s) => new(s.Id, s.Name, s.LayoutId, s.Layout?.Name, s.PlaylistId, s.Playlist?.Name, s.Priority,
        s.StartDate, s.EndDate, s.StartTime, s.EndTime, s.DaysOfWeek, s.IsActive,
        s.Targets.Select(t => new ScheduleTargetDto(t.DeviceId, t.DeviceGroupId, t.Device?.Name ?? t.DeviceGroup?.Name ?? "")).OrderBy(t => t.Name).ToArray(), s.UpdatedAt);

    public async Task<List<ScheduleDto>> ListAsync(CancellationToken ct) =>
        (await Query().AsNoTracking().AsSplitQuery().OrderByDescending(s => s.Priority).ThenBy(s => s.Name).ToListAsync(ct)).Select(ToDto).ToList();

    public async Task<ScheduleDto> GetAsync(Guid id, CancellationToken ct) =>
        ToDto(await Query().AsNoTracking().AsSplitQuery().FirstOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException("Schedule", id));

    private async Task ValidateAsync(SaveScheduleRequest r, CancellationToken ct)
    {
        var v = new Validator().Require("name", r.Name, 120);
        v.Check((r.LayoutId != null) ^ (r.PlaylistId != null), "content", "Choose either a layout or a playlist.");
        v.Check(r.EndDate == null || r.EndDate >= r.StartDate, "endDate", "End date must be on or after the start date.");
        v.Check((r.StartTime == null) == (r.EndTime == null), "startTime", "Set both a start and end time, or neither for all day.");
        v.Check(r.StartTime == null || r.StartTime != r.EndTime, "endTime", "Start and end time can't be the same.");
        v.Check(r.DaysOfWeek is >= 1 and <= 127, "daysOfWeek", "Pick at least one day.");
        v.Check(r.Priority is >= 0 and <= 100, "priority", "Priority must be between 0 and 100.");
        var dev = (r.DeviceIds ?? Array.Empty<Guid>()).Distinct().ToList();
        var grp = (r.DeviceGroupIds ?? Array.Empty<Guid>()).Distinct().ToList();
        v.Check(dev.Count + grp.Count > 0, "targets", "Choose at least one device or device group.");
        v.Check(await _db.Devices.CountAsync(d => dev.Contains(d.Id), ct) == dev.Count, "deviceIds", "A selected device no longer exists.");
        v.Check(await _db.DeviceGroups.CountAsync(g => grp.Contains(g.Id), ct) == grp.Count, "deviceGroupIds", "A selected group no longer exists.");
        if (r.LayoutId != null) v.Check(await _db.Layouts.AnyAsync(l => l.Id == r.LayoutId && !l.IsTemplate, ct), "layoutId", "Choose one of your layouts (not a template).");
        if (r.PlaylistId != null) v.Check(await _db.Playlists.AnyAsync(p => p.Id == r.PlaylistId, ct), "playlistId", "The playlist no longer exists.");
        v.ThrowIfInvalid();
    }

    private static void Apply(Schedule s, SaveScheduleRequest r)
    {
        s.Name = r.Name.Trim(); s.LayoutId = r.LayoutId; s.PlaylistId = r.PlaylistId; s.Priority = r.Priority;
        s.StartDate = r.StartDate; s.EndDate = r.EndDate; s.StartTime = r.StartTime; s.EndTime = r.EndTime;
        s.DaysOfWeek = r.DaysOfWeek; s.IsActive = r.IsActive; s.UpdatedAt = DateTime.UtcNow;
        foreach (var d in (r.DeviceIds ?? Array.Empty<Guid>()).Distinct()) s.Targets.Add(new ScheduleTarget { ScheduleId = s.Id, DeviceId = d });
        foreach (var g in (r.DeviceGroupIds ?? Array.Empty<Guid>()).Distinct()) s.Targets.Add(new ScheduleTarget { ScheduleId = s.Id, DeviceGroupId = g });
    }

    public async Task<ScheduleDto> CreateAsync(SaveScheduleRequest r, CancellationToken ct)
    {
        await ValidateAsync(r, ct);
        var s = new Schedule();
        Apply(s, r);
        _db.Schedules.Add(s);
        _audit.Record("schedule.created", "Schedule", s.Id, $"Created schedule {s.Name} targeting {s.Targets.Count} device(s)/group(s)");
        await _db.SaveChangesAsync(ct);
        await _rt.ContentChangedAsync(s.OrganizationId);
        return await GetAsync(s.Id, ct);
    }

    public async Task<ScheduleDto> UpdateAsync(Guid id, SaveScheduleRequest r, CancellationToken ct)
    {
        await ValidateAsync(r, ct);
        var s = await _db.Schedules.Include(x => x.Targets).FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Schedule", id);
        _db.ScheduleTargets.RemoveRange(s.Targets);
        s.Targets.Clear();
        Apply(s, r);
        foreach (var t in s.Targets) _db.ScheduleTargets.Add(t);
        _audit.Record("schedule.updated", "Schedule", id, $"Saved schedule {s.Name}");
        await _db.SaveChangesAsync(ct);
        await _rt.ContentChangedAsync(s.OrganizationId);
        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var s = await _db.Schedules.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Schedule", id);
        _db.Schedules.Remove(s);
        _audit.Record("schedule.deleted", "Schedule", id, $"Deleted schedule {s.Name}");
        await _db.SaveChangesAsync(ct);
        await _rt.ContentChangedAsync(s.OrganizationId);
    }
}
