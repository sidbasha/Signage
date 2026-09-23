using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;

namespace SignageCms.Application.Services;

public record LocationDto(Guid Id, string Name, string? Address, string? City, string? Country, string TimeZone, int DeviceCount);
public record SaveLocationRequest(string Name, string? Address, string? City, string? Country, string TimeZone);

public class LocationService
{
    private readonly IAppDbContext _db; private readonly AuditService _audit; private readonly IRealtimeNotifier _rt; private readonly ICurrentUser _me;
    public LocationService(IAppDbContext db, AuditService audit, IRealtimeNotifier rt, ICurrentUser me) { _db = db; _audit = audit; _rt = rt; _me = me; }

    public Task<List<LocationDto>> ListAsync(CancellationToken ct) =>
        _db.Locations.AsNoTracking().OrderBy(l => l.Name)
            .Select(l => new LocationDto(l.Id, l.Name, l.Address, l.City, l.Country, l.TimeZone, l.Devices.Count)).ToListAsync(ct);

    public static void ValidateTimeZone(Validator v, string? tz)
    {
        var ok = !string.IsNullOrWhiteSpace(tz) && TimeZoneInfo.TryFindSystemTimeZoneById(tz, out _);
        v.Check(ok, "timeZone", "Choose a valid IANA time zone, for example Asia/Kolkata.");
    }

    private static void Validate(SaveLocationRequest r)
    {
        var v = new Validator().Require("name", r.Name, 120);
        ValidateTimeZone(v, r.TimeZone);
        v.ThrowIfInvalid();
    }

    public async Task<LocationDto> CreateAsync(SaveLocationRequest r, CancellationToken ct)
    {
        Validate(r);
        var l = new Location { Name = r.Name.Trim(), Address = r.Address, City = r.City, Country = r.Country, TimeZone = r.TimeZone };
        _db.Locations.Add(l);
        _audit.Record("location.created", "Location", l.Id, $"Created location {l.Name}");
        await _db.SaveChangesAsync(ct);
        return (await ListAsync(ct)).First(x => x.Id == l.Id);
    }

    public async Task<LocationDto> UpdateAsync(Guid id, SaveLocationRequest r, CancellationToken ct)
    {
        Validate(r);
        var l = await _db.Locations.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Location", id);
        var tzChanged = l.TimeZone != r.TimeZone;
        l.Name = r.Name.Trim(); l.Address = r.Address; l.City = r.City; l.Country = r.Country; l.TimeZone = r.TimeZone;
        _audit.Record("location.updated", "Location", id, $"Updated location {l.Name}");
        await _db.SaveChangesAsync(ct);
        if (tzChanged) await _rt.ContentChangedAsync(_me.OrganizationId!.Value); // schedules are evaluated in location time
        return (await ListAsync(ct)).First(x => x.Id == id);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var l = await _db.Locations.Include(x => x.Devices).FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Location", id);
        foreach (var d in l.Devices) d.LocationId = null;
        _db.Locations.Remove(l);
        _audit.Record("location.deleted", "Location", id, $"Deleted location {l.Name}");
        await _db.SaveChangesAsync(ct);
        if (l.Devices.Count > 0) await _rt.ContentChangedAsync(_me.OrganizationId!.Value);
    }
}
