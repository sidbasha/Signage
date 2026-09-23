using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;

namespace SignageCms.Application.Services;

public record AuditLogDto(Guid Id, DateTime CreatedAt, Guid? UserId, string? UserEmail, string Action, string EntityType, string? EntityId, string? Summary, string? IpAddress);

public class AuditService
{
    private readonly IAppDbContext _db; private readonly ICurrentUser _user;
    public AuditService(IAppDbContext db, ICurrentUser user) { _db = db; _user = user; }

    /// <summary>Queues an audit entry; it is persisted by the caller's SaveChanges (same transaction as the change).</summary>
    public void Record(string action, string entityType, object? entityId, string? summary, Guid? organizationId = null)
    {
        _db.AuditLogs.Add(new AuditLog
        {
            OrganizationId = organizationId ?? _user.OrganizationId ?? Guid.Empty,
            UserId = _user.UserId, UserEmail = _user.Email, Action = action, EntityType = entityType,
            EntityId = entityId?.ToString(), Summary = summary, IpAddress = _user.IpAddress,
        });
    }

    public async Task<PagedResult<AuditLogDto>> ListAsync(int page, int pageSize, string? entityType, string? search, CancellationToken ct)
    {
        page = Math.Max(1, page); pageSize = Math.Clamp(pageSize, 1, 200);
        var q = _db.AuditLogs.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(entityType)) q = q.Where(a => a.EntityType == entityType);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            q = q.Where(a => (a.Summary ?? "").ToLower().Contains(s) || (a.UserEmail ?? "").ToLower().Contains(s) || a.Action.ToLower().Contains(s));
        }
        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(a => a.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(a => new AuditLogDto(a.Id, a.CreatedAt, a.UserId, a.UserEmail, a.Action, a.EntityType, a.EntityId, a.Summary, a.IpAddress))
            .ToListAsync(ct);
        return new(items, total, page, pageSize);
    }
}
