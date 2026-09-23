using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;
using SignageCms.Domain.Enums;

namespace SignageCms.Application.Services;

public record MediaDto(Guid Id, string Name, string Type, string? MimeType, long SizeBytes, string? Sha256, int? Width, int? Height,
    int DurationSeconds, string? Url, string? ContentUrl, string? Tags, DateTime CreatedAt, int UsedInPlaylists);
public record UploadMediaCommand(Stream Content, string FileName, string? ContentType, long Length, string? Name, int? Width, int? Height, int? DurationSeconds, string? Tags);
public record CreateWebMediaRequest(string Name, string Url, int DurationSeconds, string? Tags);
public record UpdateMediaRequest(string Name, int DurationSeconds, string? Tags, string? Url);

public class MediaService
{
    public static readonly Dictionary<string, (MediaType Type, string Mime)> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = (MediaType.Image, "image/jpeg"), [".jpeg"] = (MediaType.Image, "image/jpeg"), [".png"] = (MediaType.Image, "image/png"),
        [".gif"] = (MediaType.Image, "image/gif"), [".webp"] = (MediaType.Image, "image/webp"),
        [".mp4"] = (MediaType.Video, "video/mp4"), [".webm"] = (MediaType.Video, "video/webm"), [".m4v"] = (MediaType.Video, "video/mp4"),
    };

    private readonly IAppDbContext _db; private readonly IFileStorage _files; private readonly IUrlSigner _signer;
    private readonly ICurrentUser _me; private readonly AuditService _audit; private readonly IRealtimeNotifier _rt;
    public MediaService(IAppDbContext db, IFileStorage files, IUrlSigner signer, ICurrentUser me, AuditService audit, IRealtimeNotifier rt)
    { _db = db; _files = files; _signer = signer; _me = me; _audit = audit; _rt = rt; }

    private MediaDto ToDto(MediaAsset m, int used) => new(m.Id, m.Name, m.Type.ToString(), m.MimeType, m.SizeBytes, m.Sha256, m.Width, m.Height,
        m.DurationSeconds, m.Url, m.StorageKey != null ? _signer.SignMediaUrl(m.Id, TimeSpan.FromHours(6)) : null, m.Tags, m.CreatedAt, used);

    public async Task<List<MediaDto>> ListAsync(string? search, string? type, CancellationToken ct)
    {
        var q = _db.MediaAssets.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search)) { var s = search.Trim().ToLower(); q = q.Where(m => m.Name.ToLower().Contains(s) || (m.Tags ?? "").ToLower().Contains(s)); }
        if (Enum.TryParse<MediaType>(type, true, out var t)) q = q.Where(m => m.Type == t);
        var rows = await q.OrderByDescending(m => m.CreatedAt)
            .Select(m => new { m, used = _db.PlaylistItems.Where(i => i.MediaAssetId == m.Id).Select(i => i.PlaylistId).Distinct().Count() })
            .ToListAsync(ct);
        return rows.Select(r => ToDto(r.m, r.used)).ToList();
    }

    public async Task<MediaDto> GetAsync(Guid id, CancellationToken ct)
    {
        var m = await _db.MediaAssets.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Media", id);
        var used = await _db.PlaylistItems.Where(i => i.MediaAssetId == id).Select(i => i.PlaylistId).Distinct().CountAsync(ct);
        return ToDto(m, used);
    }

    public async Task<MediaDto> UploadAsync(UploadMediaCommand c, CancellationToken ct)
    {
        var ext = Path.GetExtension(c.FileName ?? "");
        if (!AllowedExtensions.TryGetValue(ext, out var kind))
            throw new ValidationException("file", $"'{ext}' files aren't supported. Upload JPG, PNG, GIF, WEBP, MP4 or WEBM.");
        if (c.Length <= 0) throw new ValidationException("file", "The file is empty.");
        var sub = await _db.Subscriptions.AsNoTracking().FirstAsync(ct);
        var used = await _db.MediaAssets.SumAsync(m => (long?)m.SizeBytes, ct) ?? 0;
        if (used + c.Length > sub.MaxStorageBytes)
            throw new QuotaExceededException($"This upload would exceed your {sub.Plan} plan storage ({sub.MaxStorageBytes / 1024 / 1024} MB). Delete unused media or upgrade.");

        var asset = new MediaAsset
        {
            Name = string.IsNullOrWhiteSpace(c.Name) ? Path.GetFileNameWithoutExtension(c.FileName!) : c.Name.Trim(),
            Type = kind.Type, MimeType = kind.Mime, OriginalFileName = Path.GetFileName(c.FileName), Width = c.Width, Height = c.Height,
            DurationSeconds = Math.Clamp(c.DurationSeconds ?? 10, 1, 86400), Tags = c.Tags, UploadedById = _me.UserId,
        };
        var key = $"{_me.OrganizationId}/{asset.Id:N}{ext.ToLowerInvariant()}";
        var stored = await _files.SaveAsync(c.Content, key, ct);
        asset.StorageKey = stored.Key; asset.SizeBytes = stored.SizeBytes; asset.Sha256 = stored.Sha256;
        _db.MediaAssets.Add(asset);
        _audit.Record("media.uploaded", "MediaAsset", asset.Id, $"Uploaded {asset.Name} ({stored.SizeBytes / 1024} KB)");
        try { await _db.SaveChangesAsync(ct); }
        catch { await _files.DeleteAsync(key); throw; }
        return ToDto(asset, 0);
    }

    private static void ValidateUrl(Validator v, string? url) =>
        v.Check(Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http"), "url", "Enter a full http(s) address.");

    public async Task<MediaDto> CreateWebAsync(CreateWebMediaRequest r, CancellationToken ct)
    {
        var v = new Validator().Require("name", r.Name, 200); ValidateUrl(v, r.Url);
        v.Check(r.DurationSeconds is >= 1 and <= 86400, "durationSeconds", "Duration must be between 1 second and 24 hours."); v.ThrowIfInvalid();
        var asset = new MediaAsset { Name = r.Name.Trim(), Type = MediaType.Web, Url = r.Url.Trim(), DurationSeconds = r.DurationSeconds, Tags = r.Tags, UploadedById = _me.UserId };
        _db.MediaAssets.Add(asset);
        _audit.Record("media.created", "MediaAsset", asset.Id, $"Added web page {asset.Name}");
        await _db.SaveChangesAsync(ct);
        return ToDto(asset, 0);
    }

    public async Task<MediaDto> UpdateAsync(Guid id, UpdateMediaRequest r, CancellationToken ct)
    {
        var m = await _db.MediaAssets.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Media", id);
        var v = new Validator().Require("name", r.Name, 200);
        v.Check(r.DurationSeconds is >= 1 and <= 86400, "durationSeconds", "Duration must be between 1 second and 24 hours.");
        if (m.Type == MediaType.Web) ValidateUrl(v, r.Url);
        v.ThrowIfInvalid();
        m.Name = r.Name.Trim(); m.DurationSeconds = r.DurationSeconds; m.Tags = r.Tags;
        if (m.Type == MediaType.Web) m.Url = r.Url!.Trim();
        _audit.Record("media.updated", "MediaAsset", id, $"Updated {m.Name}");
        await _db.SaveChangesAsync(ct);
        await _rt.ContentChangedAsync(m.OrganizationId);
        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var m = await _db.MediaAssets.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Media", id);
        var playlists = await _db.PlaylistItems.Where(i => i.MediaAssetId == id).Select(i => i.Playlist!.Name).Distinct().ToListAsync(ct);
        if (playlists.Count > 0) throw new ConflictException($"This media is used in {string.Join(", ", playlists)}. Remove it from those playlists first.");
        _db.MediaAssets.Remove(m);
        _audit.Record("media.deleted", "MediaAsset", id, $"Deleted {m.Name}");
        await _db.SaveChangesAsync(ct);
        if (m.StorageKey != null) await _files.DeleteAsync(m.StorageKey);
    }

    /// <summary>Resolves a signed URL to a file on disk. Anonymous: the HMAC signature is the authorization.</summary>
    public async Task<(string Path, string Mime, string Name)> ResolveSignedAsync(Guid id, long exp, string sig, CancellationToken ct)
    {
        if (!_signer.Validate(id, exp, sig)) throw new ForbiddenException("This link has expired or is invalid.");
        var m = await _db.MediaAssets.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (m?.StorageKey is null) throw new NotFoundException("Media", id);
        return (_files.GetPhysicalPath(m.StorageKey), m.MimeType ?? "application/octet-stream", m.OriginalFileName ?? m.Name);
    }
}
