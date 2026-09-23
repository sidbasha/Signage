using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using SignageCms.Application.Common;
using SignageCms.Infrastructure.Security;

namespace SignageCms.Api.Infrastructure;

public class HttpCurrentUser : ICurrentUser
{
    private readonly IHttpContextAccessor _http;
    public HttpCurrentUser(IHttpContextAccessor http) => _http = http;
    private ClaimsPrincipal? P => _http.HttpContext?.User;
    private Guid? G(string type) => Guid.TryParse(P?.FindFirst(type)?.Value, out var g) ? g : null;

    public Guid? UserId => P?.HasClaim(c => c.Type == AppClaims.Device) == true ? null : G(JwtRegisteredClaimNames.Sub) ?? G(ClaimTypes.NameIdentifier);
    public Guid? OrganizationId => G(AppClaims.Organization);
    public Guid? DeviceId => G(AppClaims.Device);
    public string? Email => P?.FindFirst(JwtRegisteredClaimNames.Email)?.Value ?? P?.FindFirst(ClaimTypes.Email)?.Value;
    public string? IpAddress => _http.HttpContext?.Connection.RemoteIpAddress?.ToString();
    public bool HasPermission(string permission) => P?.HasClaim(AppClaims.Permission, permission) == true;
}
