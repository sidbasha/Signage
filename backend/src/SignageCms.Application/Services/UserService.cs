using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;

namespace SignageCms.Application.Services;

public record UserDto(Guid Id, string Email, string FullName, bool IsActive, DateTime? LastLoginAt, DateTime CreatedAt, RoleRef[] Roles);
public record RoleRef(Guid Id, string Name);
public record CreateUserRequest(string Email, string FullName, string Password, Guid[] RoleIds);
public record UpdateUserRequest(string FullName, bool IsActive, Guid[] RoleIds, string? NewPassword);

public class UserService
{
    private readonly IAppDbContext _db; private readonly IPasswordHasher _hasher; private readonly ICurrentUser _me; private readonly AuditService _audit;
    public UserService(IAppDbContext db, IPasswordHasher hasher, ICurrentUser me, AuditService audit) { _db = db; _hasher = hasher; _me = me; _audit = audit; }

    private IQueryable<User> Query() => _db.Users.Include(u => u.UserRoles).ThenInclude(ur => ur.Role);
    private static UserDto ToDto(User u) => new(u.Id, u.Email, u.FullName, u.IsActive, u.LastLoginAt, u.CreatedAt,
        u.UserRoles.Select(r => new RoleRef(r.RoleId, r.Role!.Name)).OrderBy(r => r.Name).ToArray());

    public async Task<List<UserDto>> ListAsync(CancellationToken ct) =>
        (await Query().AsNoTracking().OrderBy(u => u.FullName).ToListAsync(ct)).Select(ToDto).ToList();

    public async Task<UserDto> GetAsync(Guid id, CancellationToken ct) =>
        ToDto(await Query().AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct) ?? throw new NotFoundException("User", id));

    private async Task<List<Role>> ResolveRolesAsync(Guid[]? ids, CancellationToken ct)
    {
        ids ??= Array.Empty<Guid>();
        var roles = await _db.Roles.Where(r => ids.Contains(r.Id)).ToListAsync(ct);
        if (roles.Count != ids.Distinct().Count()) throw new ValidationException("roleIds", "One or more roles do not exist.");
        if (roles.Count == 0) throw new ValidationException("roleIds", "Assign at least one role.");
        return roles;
    }

    public async Task<UserDto> CreateAsync(CreateUserRequest r, CancellationToken ct)
    {
        var v = new Validator().Require("email", r.Email).Require("fullName", r.FullName, 120);
        v.Check(r.Email?.Contains('@') == true, "email", "Enter a valid email address.");
        AuthService.ValidatePassword(v, r.Password);
        v.ThrowIfInvalid();
        var sub = await _db.Subscriptions.FirstAsync(ct);
        if (await _db.Users.CountAsync(u => u.IsActive, ct) >= sub.MaxUsers)
            throw new QuotaExceededException($"Your {sub.Plan} plan allows {sub.MaxUsers} active users. Upgrade the plan to add more.");
        var email = AuthService.NormalizeEmail(r.Email);
        if (await _db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email == email, ct)) throw new ConflictException("An account with this email already exists.");
        var roles = await ResolveRolesAsync(r.RoleIds, ct);
        var user = new User { Email = email, FullName = r.FullName.Trim(), PasswordHash = _hasher.Hash(r.Password) };
        foreach (var role in roles) user.UserRoles.Add(new UserRole { UserId = user.Id, RoleId = role.Id });
        _db.Users.Add(user);
        _audit.Record("user.created", "User", user.Id, $"Added {email} as {string.Join(", ", roles.Select(x => x.Name))}");
        await _db.SaveChangesAsync(ct);
        return await GetAsync(user.Id, ct);
    }

    public async Task<UserDto> UpdateAsync(Guid id, UpdateUserRequest r, CancellationToken ct)
    {
        new Validator().Require("fullName", r.FullName, 120).ThrowIfInvalid();
        var user = await Query().FirstOrDefaultAsync(u => u.Id == id, ct) ?? throw new NotFoundException("User", id);
        var roles = await ResolveRolesAsync(r.RoleIds, ct);
        if (id == _me.UserId && !r.IsActive) throw new ValidationException("isActive", "You can't deactivate your own account.");
        await EnsureOwnerRemainsAsync(user, roles, r.IsActive, ct);
        user.FullName = r.FullName.Trim();
        user.IsActive = r.IsActive;
        _db.UserRoles.RemoveRange(user.UserRoles.Where(ur => roles.All(x => x.Id != ur.RoleId)));
        foreach (var role in roles.Where(x => user.UserRoles.All(ur => ur.RoleId != x.Id)))
            _db.UserRoles.Add(new UserRole { UserId = user.Id, RoleId = role.Id });
        if (!string.IsNullOrEmpty(r.NewPassword))
        {
            var v = new Validator(); AuthService.ValidatePassword(v, r.NewPassword); v.ThrowIfInvalid();
            user.PasswordHash = _hasher.Hash(r.NewPassword);
        }
        if (!r.IsActive || !string.IsNullOrEmpty(r.NewPassword))
            await _db.RefreshTokens.Where(t => t.UserId == id && t.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTime.UtcNow), ct);
        _audit.Record("user.updated", "User", id, $"Updated {user.Email}: {(r.IsActive ? "active" : "deactivated")}, roles {string.Join(", ", roles.Select(x => x.Name))}");
        await _db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        if (id == _me.UserId) throw new ValidationException("id", "You can't delete your own account.");
        var user = await Query().FirstOrDefaultAsync(u => u.Id == id, ct) ?? throw new NotFoundException("User", id);
        await EnsureOwnerRemainsAsync(user, new List<Role>(), false, ct);
        _db.Users.Remove(user);
        _audit.Record("user.deleted", "User", id, $"Removed {user.Email}");
        await _db.SaveChangesAsync(ct);
    }

    private async Task EnsureOwnerRemainsAsync(User user, List<Role> newRoles, bool active, CancellationToken ct)
    {
        var isOwnerNow = user.UserRoles.Any(ur => ur.Role!.IsSystem && ur.Role.Name == "Owner");
        var staysOwner = active && newRoles.Any(r => r.IsSystem && r.Name == "Owner");
        if (!isOwnerNow || staysOwner) return;
        var otherOwners = await _db.UserRoles.CountAsync(ur => ur.UserId != user.Id && ur.User!.IsActive && ur.Role!.IsSystem && ur.Role.Name == "Owner", ct);
        if (otherOwners == 0) throw new ValidationException("roleIds", "The organization must keep at least one active Owner.");
    }
}
