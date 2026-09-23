using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;
using SignageCms.Domain.Enums;

namespace SignageCms.Application.Services;

public record ZoneDto(Guid Id, string Name, double X, double Y, double Width, double Height, int ZIndex, Guid? PlaylistId, string? PlaylistName);
public record LayoutDto(Guid Id, string Name, string? Description, string Orientation, int Width, int Height, string BackgroundColor, bool IsTemplate, DateTime UpdatedAt, ZoneDto[] Zones);
public record SaveZone(string Name, double X, double Y, double Width, double Height, int ZIndex, Guid? PlaylistId);
public record SaveLayoutRequest(string Name, string? Description, string Orientation, int Width, int Height, string? BackgroundColor, SaveZone[] Zones);
public record FromTemplateRequest(string Name);

public class LayoutService
{
    private readonly IAppDbContext _db; private readonly AuditService _audit; private readonly IRealtimeNotifier _rt;
    public LayoutService(IAppDbContext db, AuditService audit, IRealtimeNotifier rt) { _db = db; _audit = audit; _rt = rt; }

    private static LayoutDto ToDto(Layout l) => new(l.Id, l.Name, l.Description, l.Orientation.ToString(), l.Width, l.Height, l.BackgroundColor, l.IsTemplate, l.UpdatedAt,
        l.Zones.OrderBy(z => z.ZIndex).Select(z => new ZoneDto(z.Id, z.Name, z.X, z.Y, z.Width, z.Height, z.ZIndex, z.PlaylistId, z.Playlist?.Name)).ToArray());

    private IQueryable<Layout> Query() => _db.Layouts.Include(l => l.Zones).ThenInclude(z => z.Playlist);

    public async Task<List<LayoutDto>> ListAsync(bool templates, CancellationToken ct) =>
        (await Query().AsNoTracking().Where(l => l.IsTemplate == templates).OrderBy(l => l.Name).ToListAsync(ct)).Select(ToDto).ToList();

    public async Task<LayoutDto> GetAsync(Guid id, CancellationToken ct) =>
        ToDto(await Query().AsNoTracking().FirstOrDefaultAsync(l => l.Id == id, ct) ?? throw new NotFoundException("Layout", id));

    private async Task<Orientation> ValidateAsync(SaveLayoutRequest r, CancellationToken ct)
    {
        var v = new Validator().Require("name", r.Name, 120);
        v.Check(Enum.TryParse<Orientation>(r.Orientation, true, out var o), "orientation", "Orientation must be Landscape or Portrait.");
        v.Check(r.Width is >= 320 and <= 7680 && r.Height is >= 240 and <= 7680, "width", "Resolution must be between 320×240 and 7680×7680.");
        v.Check(r.BackgroundColor is null || System.Text.RegularExpressions.Regex.IsMatch(r.BackgroundColor, "^#[0-9a-fA-F]{6}$"), "backgroundColor", "Use a hex color like #000000.");
        var zones = r.Zones ?? Array.Empty<SaveZone>();
        v.Check(zones.Length is >= 1 and <= 12, "zones", "A layout needs between 1 and 12 zones.");
        for (var i = 0; i < zones.Length; i++)
        {
            var z = zones[i];
            v.Check(!string.IsNullOrWhiteSpace(z.Name), $"zones[{i}].name", "Every zone needs a name.");
            v.Check(z.X >= 0 && z.Y >= 0 && z.Width > 0 && z.Height > 0 && z.X + z.Width <= 100.0001 && z.Y + z.Height <= 100.0001,
                $"zones[{i}]", $"Zone '{z.Name}' must fit inside the screen (0–100%).");
        }
        var pids = zones.Where(z => z.PlaylistId != null).Select(z => z.PlaylistId!.Value).Distinct().ToList();
        v.Check(await _db.Playlists.CountAsync(p => pids.Contains(p.Id), ct) == pids.Count, "zones", "A zone refers to a playlist that no longer exists.");
        v.ThrowIfInvalid();
        return o;
    }

    private static void ApplyZones(Layout l, SaveZone[] zones)
    {
        foreach (var z in zones)
            l.Zones.Add(new LayoutZone { LayoutId = l.Id, Name = z.Name.Trim(), X = z.X, Y = z.Y, Width = z.Width, Height = z.Height, ZIndex = z.ZIndex, PlaylistId = z.PlaylistId });
    }

    public async Task<LayoutDto> CreateAsync(SaveLayoutRequest r, CancellationToken ct)
    {
        var o = await ValidateAsync(r, ct);
        var l = new Layout { Name = r.Name.Trim(), Description = r.Description, Orientation = o, Width = r.Width, Height = r.Height, BackgroundColor = r.BackgroundColor ?? "#000000" };
        ApplyZones(l, r.Zones);
        _db.Layouts.Add(l);
        _audit.Record("layout.created", "Layout", l.Id, $"Created layout {l.Name} with {l.Zones.Count} zones");
        await _db.SaveChangesAsync(ct);
        return await GetAsync(l.Id, ct);
    }

    public async Task<LayoutDto> FromTemplateAsync(Guid templateId, FromTemplateRequest r, CancellationToken ct)
    {
        new Validator().Require("name", r.Name, 120).ThrowIfInvalid();
        var t = await _db.Layouts.Include(x => x.Zones).AsNoTracking().FirstOrDefaultAsync(x => x.Id == templateId && x.IsTemplate, ct) ?? throw new NotFoundException("Template", templateId);
        var l = new Layout { Name = r.Name.Trim(), Description = t.Description, Orientation = t.Orientation, Width = t.Width, Height = t.Height, BackgroundColor = t.BackgroundColor };
        ApplyZones(l, t.Zones.Select(z => new SaveZone(z.Name, z.X, z.Y, z.Width, z.Height, z.ZIndex, null)).ToArray());
        _db.Layouts.Add(l);
        _audit.Record("layout.created", "Layout", l.Id, $"Created layout {l.Name} from template {t.Name}");
        await _db.SaveChangesAsync(ct);
        return await GetAsync(l.Id, ct);
    }

    public async Task<LayoutDto> UpdateAsync(Guid id, SaveLayoutRequest r, CancellationToken ct)
    {
        var o = await ValidateAsync(r, ct);
        var l = await _db.Layouts.Include(x => x.Zones).FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Layout", id);
        if (l.IsTemplate) throw new ForbiddenException("Templates are read-only. Create a layout from the template instead.");
        l.Name = r.Name.Trim(); l.Description = r.Description; l.Orientation = o; l.Width = r.Width; l.Height = r.Height; l.BackgroundColor = r.BackgroundColor ?? "#000000";
        l.UpdatedAt = DateTime.UtcNow;
        _db.LayoutZones.RemoveRange(l.Zones);
        l.Zones.Clear();
        ApplyZones(l, r.Zones);
        foreach (var z in l.Zones) _db.LayoutZones.Add(z);
        _audit.Record("layout.updated", "Layout", id, $"Saved layout {l.Name} ({l.Zones.Count} zones)");
        await _db.SaveChangesAsync(ct);
        await _rt.ContentChangedAsync(l.OrganizationId);
        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var l = await _db.Layouts.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Layout", id);
        if (l.IsTemplate) throw new ForbiddenException("Templates can't be deleted.");
        var used = await _db.Schedules.CountAsync(s => s.LayoutId == id, ct);
        if (used > 0) throw new ConflictException($"{used} schedule(s) use this layout. Change or delete them first.");
        _db.Layouts.Remove(l);
        _audit.Record("layout.deleted", "Layout", id, $"Deleted layout {l.Name}");
        await _db.SaveChangesAsync(ct);
    }
}
