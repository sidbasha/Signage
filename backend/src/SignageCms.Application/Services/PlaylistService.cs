using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;

namespace SignageCms.Application.Services;

public record PlaylistItemDto(Guid Id, Guid MediaAssetId, string MediaName, string MediaType, int SortOrder, int? DurationSeconds, int EffectiveDurationSeconds, string Transition, string? ContentUrl);
public record PlaylistDto(Guid Id, string Name, string? Description, bool Shuffle, int ItemCount, int TotalDurationSeconds, DateTime UpdatedAt, PlaylistItemDto[] Items);
public record SavePlaylistItem(Guid MediaAssetId, int? DurationSeconds, string? Transition);
public record SavePlaylistRequest(string Name, string? Description, bool Shuffle, SavePlaylistItem[] Items);

public class PlaylistService
{
    private static readonly string[] Transitions = { "none", "fade", "slide" };
    private readonly IAppDbContext _db; private readonly AuditService _audit; private readonly IRealtimeNotifier _rt; private readonly IUrlSigner _signer; private readonly ICurrentUser _me;
    public PlaylistService(IAppDbContext db, AuditService audit, IRealtimeNotifier rt, IUrlSigner signer, ICurrentUser me) { _db = db; _audit = audit; _rt = rt; _signer = signer; _me = me; }

    private PlaylistDto ToDto(Playlist p)
    {
        var items = p.Items.OrderBy(i => i.SortOrder).Select(i => new PlaylistItemDto(i.Id, i.MediaAssetId, i.MediaAsset!.Name, i.MediaAsset.Type.ToString(), i.SortOrder,
            i.DurationSeconds, i.DurationSeconds ?? i.MediaAsset.DurationSeconds, i.Transition,
            i.MediaAsset.StorageKey != null ? _signer.SignMediaUrl(i.MediaAssetId, TimeSpan.FromHours(6)) : i.MediaAsset.Url)).ToArray();
        return new(p.Id, p.Name, p.Description, p.Shuffle, items.Length, items.Sum(i => i.EffectiveDurationSeconds), p.UpdatedAt, items);
    }

    private IQueryable<Playlist> Query() => _db.Playlists.Include(p => p.Items).ThenInclude(i => i.MediaAsset);

    public async Task<List<PlaylistDto>> ListAsync(CancellationToken ct) =>
        (await Query().AsNoTracking().AsSplitQuery().OrderBy(p => p.Name).ToListAsync(ct)).Select(ToDto).ToList();

    public async Task<PlaylistDto> GetAsync(Guid id, CancellationToken ct) =>
        ToDto(await Query().AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct) ?? throw new NotFoundException("Playlist", id));

    private async Task ValidateAsync(SavePlaylistRequest r, CancellationToken ct)
    {
        var v = new Validator().Require("name", r.Name, 120);
        var items = r.Items ?? Array.Empty<SavePlaylistItem>();
        v.Check(items.Length <= 500, "items", "A playlist can hold at most 500 items.");
        v.Check(items.All(i => i.DurationSeconds is null or (>= 1 and <= 86400)), "items", "Item durations must be between 1 second and 24 hours.");
        v.Check(items.All(i => i.Transition is null || Transitions.Contains(i.Transition)), "items", "Transition must be none, fade or slide.");
        var ids = items.Select(i => i.MediaAssetId).Distinct().ToList();
        var found = await _db.MediaAssets.CountAsync(m => ids.Contains(m.Id), ct);
        v.Check(found == ids.Count, "items", "One or more media items no longer exist.");
        v.ThrowIfInvalid();
    }

    private static void ApplyItems(Playlist p, SavePlaylistItem[] items)
    {
        var order = 0;
        foreach (var i in items)
            p.Items.Add(new PlaylistItem { PlaylistId = p.Id, MediaAssetId = i.MediaAssetId, SortOrder = order++, DurationSeconds = i.DurationSeconds, Transition = i.Transition ?? "fade" });
    }

    public async Task<PlaylistDto> CreateAsync(SavePlaylistRequest r, CancellationToken ct)
    {
        await ValidateAsync(r, ct);
        var p = new Playlist { Name = r.Name.Trim(), Description = r.Description, Shuffle = r.Shuffle };
        ApplyItems(p, r.Items ?? Array.Empty<SavePlaylistItem>());
        _db.Playlists.Add(p);
        _audit.Record("playlist.created", "Playlist", p.Id, $"Created playlist {p.Name} with {p.Items.Count} items");
        await _db.SaveChangesAsync(ct);
        return await GetAsync(p.Id, ct);
    }

    public async Task<PlaylistDto> UpdateAsync(Guid id, SavePlaylistRequest r, CancellationToken ct)
    {
        await ValidateAsync(r, ct);
        var p = await _db.Playlists.Include(x => x.Items).FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Playlist", id);
        p.Name = r.Name.Trim(); p.Description = r.Description; p.Shuffle = r.Shuffle;
        p.UpdatedAt = DateTime.UtcNow; // items-only edits must still bump the version
        _db.PlaylistItems.RemoveRange(p.Items);
        p.Items.Clear();
        ApplyItems(p, r.Items ?? Array.Empty<SavePlaylistItem>());
        foreach (var i in p.Items) _db.PlaylistItems.Add(i);
        _audit.Record("playlist.updated", "Playlist", id, $"Saved playlist {p.Name} ({p.Items.Count} items)");
        await _db.SaveChangesAsync(ct);
        await _rt.ContentChangedAsync(p.OrganizationId);
        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var p = await _db.Playlists.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Playlist", id);
        var inSchedules = await _db.Schedules.CountAsync(s => s.PlaylistId == id, ct);
        if (inSchedules > 0) throw new ConflictException($"{inSchedules} schedule(s) use this playlist. Change or delete them first.");
        // Zones, device and group defaults fall back to nothing (FK set null).
        _db.Playlists.Remove(p);
        _audit.Record("playlist.deleted", "Playlist", id, $"Deleted playlist {p.Name}");
        await _db.SaveChangesAsync(ct);
        await _rt.ContentChangedAsync(p.OrganizationId);
    }
}
