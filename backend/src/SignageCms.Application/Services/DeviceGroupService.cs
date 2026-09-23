using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;

namespace SignageCms.Application.Services;

public record DeviceGroupDto(Guid Id, string Name, string? Description, Guid? DefaultPlaylistId, string? DefaultPlaylistName, RoleRef[] Devices);
public record SaveDeviceGroupRequest(string Name, string? Description, Guid? DefaultPlaylistId, Guid[]? DeviceIds);

public class DeviceGroupService
{
    private readonly IAppDbContext _db; private readonly AuditService _audit; private readonly IRealtimeNotifier _rt;
    public DeviceGroupService(IAppDbContext db, AuditService audit, IRealtimeNotifier rt) { _db = db; _audit = audit; _rt = rt; }

    private IQueryable<DeviceGroup> Query() => _db.DeviceGroups.Include(g => g.DefaultPlaylist).Include(g => g.Members).ThenInclude(m => m.Device);
    private static DeviceGroupDto ToDto(DeviceGroup g) => new(g.Id, g.Name, g.Description, g.DefaultPlaylistId, g.DefaultPlaylist?.Name,
        g.Members.Select(m => new RoleRef(m.DeviceId, m.Device?.Name ?? "")).OrderBy(x => x.Name).ToArray());

    public async Task<List<DeviceGroupDto>> ListAsync(CancellationToken ct) => (await Query().AsNoTracking().OrderBy(g => g.Name).ToListAsync(ct)).Select(ToDto).ToList();
    public async Task<DeviceGroupDto> GetAsync(Guid id, CancellationToken ct) => ToDto(await Query().AsNoTracking().FirstOrDefaultAsync(g => g.Id == id, ct) ?? throw new NotFoundException("Device group", id));

    private async Task<List<Guid>> ValidateAsync(SaveDeviceGroupRequest r, Guid? id, CancellationToken ct)
    {
        var v = new Validator().Require("name", r.Name, 120);
        var ids = (r.DeviceIds ?? Array.Empty<Guid>()).Distinct().ToList();
        v.Check(await _db.Devices.CountAsync(d => ids.Contains(d.Id), ct) == ids.Count, "deviceIds", "A selected device no longer exists.");
        if (r.DefaultPlaylistId != null) v.Check(await _db.Playlists.AnyAsync(p => p.Id == r.DefaultPlaylistId, ct), "defaultPlaylistId", "Playlist not found.");
        v.Check(!await _db.DeviceGroups.AnyAsync(g => g.Id != id && g.Name == r.Name.Trim(), ct), "name", "A group with this name already exists.");
        v.ThrowIfInvalid();
        return ids;
    }

    public async Task<DeviceGroupDto> CreateAsync(SaveDeviceGroupRequest r, CancellationToken ct)
    {
        var ids = await ValidateAsync(r, null, ct);
        var g = new DeviceGroup { Name = r.Name.Trim(), Description = r.Description, DefaultPlaylistId = r.DefaultPlaylistId };
        foreach (var d in ids) g.Members.Add(new DeviceGroupMember { DeviceGroupId = g.Id, DeviceId = d });
        _db.DeviceGroups.Add(g);
        _audit.Record("group.created", "DeviceGroup", g.Id, $"Created group {g.Name} with {ids.Count} device(s)");
        await _db.SaveChangesAsync(ct);
        await _rt.ContentChangedAsync(g.OrganizationId);
        return await GetAsync(g.Id, ct);
    }

    public async Task<DeviceGroupDto> UpdateAsync(Guid id, SaveDeviceGroupRequest r, CancellationToken ct)
    {
        var ids = await ValidateAsync(r, id, ct);
        var g = await _db.DeviceGroups.Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Device group", id);
        g.Name = r.Name.Trim(); g.Description = r.Description; g.DefaultPlaylistId = r.DefaultPlaylistId;
        _db.DeviceGroupMembers.RemoveRange(g.Members.Where(m => !ids.Contains(m.DeviceId)));
        foreach (var d in ids.Where(d => g.Members.All(m => m.DeviceId != d))) _db.DeviceGroupMembers.Add(new DeviceGroupMember { DeviceGroupId = id, DeviceId = d });
        _audit.Record("group.updated", "DeviceGroup", id, $"Saved group {g.Name} ({ids.Count} device(s))");
        await _db.SaveChangesAsync(ct);
        await _rt.ContentChangedAsync(g.OrganizationId);
        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var g = await _db.DeviceGroups.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Device group", id);
        _db.DeviceGroups.Remove(g);
        _audit.Record("group.deleted", "DeviceGroup", id, $"Deleted group {g.Name}");
        await _db.SaveChangesAsync(ct);
        await _rt.ContentChangedAsync(g.OrganizationId);
    }
}
