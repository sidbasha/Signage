using SignageCms.Application.Common;
using SignageCms.Domain.Entities;
using SignageCms.Domain.Enums;

namespace SignageCms.Application.Services;

/// <summary>Creates everything a new tenant needs: subscription, system roles and starter layout templates.</summary>
public class OrganizationProvisioner
{
    private readonly IAppDbContext _db; private readonly IClock _clock;
    public OrganizationProvisioner(IAppDbContext db, IClock clock) { _db = db; _clock = clock; }

    public (Organization Org, Dictionary<string, Role> Roles) Provision(string name, string timeZone = "UTC")
    {
        var org = new Organization { Name = name.Trim(), Slug = Slugify(name) + "-" + Crypto.RandomToken(3).ToLowerInvariant(), DefaultTimeZone = timeZone };
        _db.Organizations.Add(org);

        var sub = new Subscription { OrganizationId = org.Id, StartsAt = _clock.UtcNow };
        Plans.Apply(sub, SubscriptionPlan.Free);
        _db.Subscriptions.Add(sub);

        var roles = new Dictionary<string, Role>();
        foreach (var (roleName, desc, perms) in Permissions.SystemRoles)
        {
            var role = new Role { OrganizationId = org.Id, Name = roleName, Description = desc, IsSystem = true };
            foreach (var p in perms) role.Permissions.Add(new RolePermission { RoleId = role.Id, PermissionCode = p });
            _db.Roles.Add(role);
            roles[roleName] = role;
        }

        foreach (var t in Templates(org.Id)) _db.Layouts.Add(t);
        return (org, roles);
    }

    private static IEnumerable<Layout> Templates(Guid orgId)
    {
        Layout L(string name, string desc, Orientation o, params (string Name, double X, double Y, double W, double H)[] zones)
        {
            var l = new Layout { OrganizationId = orgId, Name = name, Description = desc, IsTemplate = true, Orientation = o,
                Width = o == Orientation.Landscape ? 1920 : 1080, Height = o == Orientation.Landscape ? 1080 : 1920 };
            var z = 0;
            foreach (var zone in zones)
                l.Zones.Add(new LayoutZone { LayoutId = l.Id, Name = zone.Name, X = zone.X, Y = zone.Y, Width = zone.W, Height = zone.H, ZIndex = z++ });
            return l;
        }
        yield return L("Full screen", "One zone that fills the screen", Orientation.Landscape, ("Main", 0, 0, 100, 100));
        yield return L("Main with sidebar", "Large main zone and a right sidebar", Orientation.Landscape, ("Main", 0, 0, 70, 100), ("Sidebar", 70, 0, 30, 100));
        yield return L("Main with ticker", "Main zone with a strip along the bottom", Orientation.Landscape, ("Main", 0, 0, 100, 85), ("Ticker", 0, 85, 100, 15));
        yield return L("L-shape", "Main zone, sidebar and bottom strip", Orientation.Landscape, ("Main", 0, 0, 75, 80), ("Sidebar", 75, 0, 25, 80), ("Bottom", 0, 80, 100, 20));
        yield return L("Quad grid", "Four equal zones", Orientation.Landscape, ("Top left", 0, 0, 50, 50), ("Top right", 50, 0, 50, 50), ("Bottom left", 0, 50, 50, 50), ("Bottom right", 50, 50, 50, 50));
        yield return L("Portrait split", "Portrait screen split top and bottom", Orientation.Portrait, ("Top", 0, 0, 100, 60), ("Bottom", 0, 60, 100, 40));
    }

    public static string Slugify(string s)
    {
        var chars = s.Trim().ToLowerInvariant().Select(c => char.IsLetterOrDigit(c) ? c : '-').ToArray();
        var slug = string.Join('-', new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries));
        return slug.Length == 0 ? "org" : slug[..Math.Min(slug.Length, 40)];
    }
}
