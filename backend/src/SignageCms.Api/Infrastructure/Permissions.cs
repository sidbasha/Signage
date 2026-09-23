using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using SignageCms.Infrastructure.Security;

namespace SignageCms.Api.Infrastructure;

/// <summary>[HasPermission("media.manage")] — requires an authenticated admin user whose token carries the permission.</summary>
public class HasPermissionAttribute : AuthorizeAttribute
{
    public const string Prefix = "perm:";
    public HasPermissionAttribute(string permission) : base(Prefix + permission) { }
}

public class PermissionRequirement : IAuthorizationRequirement
{
    public string Permission { get; }
    public PermissionRequirement(string p) => Permission = p;
}

public class PermissionHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext ctx, PermissionRequirement req)
    {
        if (ctx.User.HasClaim(AppClaims.Permission, req.Permission)) ctx.Succeed(req);
        return Task.CompletedTask;
    }
}

public class PermissionPolicyProvider : DefaultAuthorizationPolicyProvider
{
    public PermissionPolicyProvider(IOptions<AuthorizationOptions> o) : base(o) { }
    public override async Task<AuthorizationPolicy?> GetPolicyAsync(string name)
    {
        if (!name.StartsWith(HasPermissionAttribute.Prefix)) return await base.GetPolicyAsync(name);
        return new AuthorizationPolicyBuilder(JwtBearerDefaults.AuthenticationScheme)
            .RequireAuthenticatedUser()
            .AddRequirements(new PermissionRequirement(name[HasPermissionAttribute.Prefix.Length..]))
            .Build();
    }
}
