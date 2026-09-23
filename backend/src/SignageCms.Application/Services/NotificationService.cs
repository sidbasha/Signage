using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;
using SignageCms.Domain.Enums;

namespace SignageCms.Application.Services;

public record NotificationDto(Guid Id, DateTime CreatedAt, string Severity, string Category, string Title, string Message, string? Link, bool IsRead);

public class NotificationService
{
    private readonly IAppDbContext _db; private readonly ICurrentUser _user; private readonly IRealtimeNotifier _rt;
    public NotificationService(IAppDbContext db, ICurrentUser user, IRealtimeNotifier rt) { _db = db; _user = user; _rt = rt; }

    public static NotificationDto ToDto(Notification n) =>
        new(n.Id, n.CreatedAt, n.Severity.ToString(), n.Category, n.Title, n.Message, n.Link, n.IsRead);

    /// <summary>Queue an organization-wide notification. Call <see cref="PublishAsync"/> after SaveChanges.</summary>
    public Notification Add(Guid organizationId, NotificationSeverity severity, string category, string title, string message, string? link = null)
    {
        var n = new Notification { OrganizationId = organizationId, Severity = severity, Category = category, Title = title, Message = message, Link = link };
        _db.Notifications.Add(n);
        return n;
    }

    public Task PublishAsync(Notification n) => _rt.NotificationCreatedAsync(n.OrganizationId, ToDto(n));

    private IQueryable<Notification> Mine() => _db.Notifications.Where(n => n.UserId == null || n.UserId == _user.UserId);

    public async Task<object> ListAsync(bool unreadOnly, int take, CancellationToken ct)
    {
        var q = Mine().AsNoTracking();
        if (unreadOnly) q = q.Where(n => !n.IsRead);
        var items = await q.OrderByDescending(n => n.CreatedAt).Take(Math.Clamp(take, 1, 200)).ToListAsync(ct);
        var unread = await Mine().CountAsync(n => !n.IsRead, ct);
        return new { items = items.Select(ToDto), unreadCount = unread };
    }

    public async Task MarkReadAsync(Guid id, CancellationToken ct)
    {
        var n = await Mine().FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Notification", id);
        n.IsRead = true;
        await _db.SaveChangesAsync(ct);
    }

    public async Task<int> MarkAllReadAsync(CancellationToken ct)
        => await Mine().Where(n => !n.IsRead).ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true), ct);
}
