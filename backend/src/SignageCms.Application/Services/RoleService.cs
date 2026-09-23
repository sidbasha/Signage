using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;

namespace SignageCms.Application.Services;

public record RoleDto(Guid Id, string Name, string? Description, bool IsSystem, string[] Permissions, int UserCount);
public record SaveRoleRequest(string Name, string? Description, string[] Permissions);
public record PermissionDto(string Code, string Group, string Description);

public class RoleService
{
    private readonly IAppDbContext _db; private readonly AuditService _audit;
    public RoleService(IAppDbContext db, AuditService audit) { _db = db; _audit = audit; }

    public List<PermissionDto> AllPermissions() => Permissions.All.Select(p => new PermissionDto(p.Code, p.Group, p.Description)).ToList();

    public async Task<List<RoleDto>> ListAsync(CancellationToken ct) =>
        await _db.Roles.AsNoTracking().OrderByDescending(r => r.IsSystem).ThenBy(r => r.Name)
            .Select(r => new RoleDto(r.Id, r.Name, r.Description, r.IsSystem, r.Permissions.Select(p => p.PermissionCode).ToArray(), r.UserRoles.Count))
            .ToListAsync(ct);

    private static string[] Validate(SaveRoleRequest r)
    {
        var v = new Validator().Require("name", r.Name, 60);
        var valid = Permissions.All.Select(p => p.Code).ToHashSet();
        var perms = (r.Permissions ?? Array.Empty<string>()).Distinct().ToArray();
        v.Check(perms.All(valid.Contains), "permissions", "Unknown permission code.");
        v.ThrowIfInvalid();
        return perms;
    }

    public async Task<RoleDto> CreateAsync(SaveRoleRequest r, CancellationToken ct)
    {
        var perms = Validate(r);
        if (await _db.Roles.AnyAsync(x => x.Name == r.Name.Trim(), ct)) throw new ConflictException("A role with this name already exists.");
        var role = new Role { Name = r.Name.Trim(), Description = r.Description };
        foreach (var p in perms) role.Permissions.Add(new RolePermission { RoleId = role.Id, PermissionCode = p });
        _db.Roles.Add(role);
        _audit.Record("role.created", "Role", role.Id, $"Created role {role.Name} with {perms.Length} permissions");
        await _db.SaveChangesAsync(ct);
        return (await ListAsync(ct)).First(x => x.Id == role.Id);
    }

    public async Task<RoleDto> UpdateAsync(Guid id, SaveRoleRequest r, CancellationToken ct)
    {
        var perms = Validate(r);
        var role = await _db.Roles.Include(x => x.Permissions).FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Role", id);
        if (role.IsSystem) throw new ForbiddenException("Built-in roles can't be changed. Create a custom role instead.");
        if (await _db.Roles.AnyAsync(x => x.Id != id && x.Name == r.Name.Trim(), ct)) throw new ConflictException("A role with this name already exists.");
        role.Name = r.Name.Trim(); role.Description = r.Description;
        _db.RolePermissions.RemoveRange(role.Permissions.Where(p => !perms.Contains(p.PermissionCode)));
        foreach (var p in perms.Where(p => role.Permissions.All(x => x.PermissionCode != p)))
            _db.RolePermissions.Add(new RolePermission { RoleId = role.Id, PermissionCode = p });
        _audit.Record("role.updated", "Role", id, $"Updated role {role.Name} ({perms.Length} permissions)");
        await _db.SaveChangesAsync(ct);
        return (await ListAsync(ct)).First(x => x.Id == id);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var role = await _db.Roles.Include(r => r.UserRoles).FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException("Role", id);
        if (role.IsSystem) throw new ForbiddenException("Built-in roles can't be deleted.");
        if (role.UserRoles.Count > 0) throw new ConflictException($"{role.UserRoles.Count} user(s) still have this role. Reassign them first.");
        _db.Roles.Remove(role);
        _audit.Record("role.deleted", "Role", id, $"Deleted role {role.Name}");
        await _db.SaveChangesAsync(ct);
    }
}
