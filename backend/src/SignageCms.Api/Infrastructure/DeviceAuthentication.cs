using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SignageCms.Application.Services;
using SignageCms.Infrastructure.Persistence;
using SignageCms.Infrastructure.Security;

namespace SignageCms.Api.Infrastructure;

/// <summary>
/// Authenticates paired players by their device key, sent as "Authorization: Device &lt;key&gt;"
/// or (for WebSocket/SSE connections that cannot set headers) as the access_token query parameter.
/// </summary>
public class DeviceAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string Scheme = "Device";
    private readonly AppDbContext _db;
    public DeviceAuthenticationHandler(IOptionsMonitor<AuthenticationSchemeOptions> o, ILoggerFactory l, UrlEncoder e, AppDbContext db) : base(o, l, e) => _db = db;

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        string? key = null;
        var header = Request.Headers.Authorization.ToString();
        if (header.StartsWith("Device ", StringComparison.OrdinalIgnoreCase)) key = header[7..].Trim();
        else if (Request.Path.StartsWithSegments("/hubs/device"))
            // SignalR clients send accessTokenFactory's value as a Bearer header (negotiate/long-polling) or access_token query (WebSockets/SSE).
            key = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : Request.Query["access_token"].ToString();
        if (string.IsNullOrEmpty(key)) return AuthenticateResult.NoResult();

        var hash = Crypto.Sha256(key);
        var device = await _db.Devices.IgnoreQueryFilters().AsNoTracking()
            .Where(d => d.DeviceKeyHash == hash).Select(d => new { d.Id, d.OrganizationId, d.Name }).FirstOrDefaultAsync();
        if (device is null) return AuthenticateResult.Fail("Unknown or revoked device key.");

        var identity = new ClaimsIdentity(new[]
        {
            new Claim(AppClaims.Device, device.Id.ToString()),
            new Claim(AppClaims.Organization, device.OrganizationId.ToString()),
            new Claim(ClaimTypes.Name, device.Name),
            new Claim(ClaimTypes.Role, "Device"),
        }, Scheme);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme));
    }
}
