using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SignageCms.Application.Common;
using SignageCms.Application.Services;
using SignageCms.Domain.Entities;

namespace SignageCms.Infrastructure.Persistence;

public class DbSeeder
{
    private readonly AppDbContext _db; private readonly IPasswordHasher _hasher; private readonly OrganizationProvisioner _provisioner;
    private readonly IConfiguration _config; private readonly ILogger<DbSeeder> _log;
    public DbSeeder(AppDbContext db, IPasswordHasher hasher, OrganizationProvisioner provisioner, IConfiguration config, ILogger<DbSeeder> log)
    { _db = db; _hasher = hasher; _provisioner = provisioner; _config = config; _log = log; }

    public async Task SeedAsync(CancellationToken ct = default)
    {
        await _db.Database.EnsureCreatedAsync(ct);

        // Permission catalogue is code-defined; keep the table in sync on every start.
        var existing = await _db.Permissions.ToDictionaryAsync(p => p.Code, ct);
        foreach (var (code, group, desc) in Permissions.All)
        {
            if (existing.TryGetValue(code, out var p)) { p.Group = group; p.Description = desc; }
            else _db.Permissions.Add(new Permission { Code = code, Group = group, Description = desc });
        }
        await _db.SaveChangesAsync(ct);

        var email = _config["Seed:AdminEmail"];
        var password = _config["Seed:AdminPassword"];
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password)) return;
        if (await _db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email == email.ToLower(), ct)) return;

        var (org, roles) = _provisioner.Provision(_config["Seed:OrganizationName"] ?? "Demo Organization", _config["Seed:TimeZone"] ?? "UTC");
        var user = new User { OrganizationId = org.Id, Email = email.ToLowerInvariant(), FullName = "Demo Owner", PasswordHash = _hasher.Hash(password) };
        user.UserRoles.Add(new UserRole { UserId = user.Id, RoleId = roles["Owner"].Id });
        _db.Users.Add(user);
        _db.Locations.Add(new Location { OrganizationId = org.Id, Name = "Head office", City = "Chennai", Country = "India", TimeZone = _config["Seed:TimeZone"] ?? "UTC" });
        await _db.SaveChangesAsync(ct);
        _log.LogInformation("Seeded demo organization {Org} with owner {Email}", org.Name, email);
    }
}
