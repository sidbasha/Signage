using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;

namespace SignageCms.Infrastructure.Security;

public class JwtOptions
{
    public string Issuer { get; set; } = "signage-cms";
    public string Audience { get; set; } = "signage-cms";
    /// <summary>HMAC secret, at least 32 bytes. Also used to sign media URLs.</summary>
    public string SigningKey { get; set; } = "";
    public int AccessTokenMinutes { get; set; } = 15;
}

public static class AppClaims
{
    public const string Organization = "org";
    public const string OrganizationName = "org_name";
    public const string Permission = "perm";
    public const string Device = "device";
}

public class JwtTokenService : ITokenService
{
    private readonly JwtOptions _o;
    public JwtTokenService(IOptions<JwtOptions> o) => _o = o.Value;

    public AccessToken CreateAccessToken(User user, string organizationName, IEnumerable<string> roles, IEnumerable<string> permissions)
    {
        var expires = DateTime.UtcNow.AddMinutes(_o.AccessTokenMinutes);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(JwtRegisteredClaimNames.Name, user.FullName),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            new(AppClaims.Organization, user.OrganizationId.ToString()),
            new(AppClaims.OrganizationName, organizationName),
        };
        claims.AddRange(roles.Select(r => new Claim(ClaimTypes.Role, r)));
        claims.AddRange(permissions.Select(p => new Claim(AppClaims.Permission, p)));
        var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_o.SigningKey)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(_o.Issuer, _o.Audience, claims, DateTime.UtcNow, expires, creds);
        return new AccessToken(new JwtSecurityTokenHandler().WriteToken(token), expires);
    }
}

/// <summary>PBKDF2 (ASP.NET Core Identity v3 format) password hashing.</summary>
public class IdentityPasswordHasher : IPasswordHasher
{
    private readonly PasswordHasher<object> _inner = new();
    private static readonly object Subject = new();
    public string Hash(string password) => _inner.HashPassword(Subject, password);
    public bool Verify(string hash, string password)
    {
        try { return _inner.VerifyHashedPassword(Subject, hash, password) != PasswordVerificationResult.Failed; }
        catch (FormatException) { return false; }
    }
}

public class HmacUrlSigner : IUrlSigner
{
    private readonly byte[] _key;
    public HmacUrlSigner(IOptions<JwtOptions> o) => _key = SHA256.HashData(Encoding.UTF8.GetBytes("media-url:" + o.Value.SigningKey));

    private string Sig(Guid id, long exp) =>
        Convert.ToHexString(HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes($"{id:N}.{exp}"))).ToLowerInvariant()[..32];

    public string SignMediaUrl(Guid mediaId, TimeSpan lifetime)
    {
        // Round expiry to the hour so URLs are cache-friendly for browsers and players.
        var exp = DateTimeOffset.UtcNow.Add(lifetime).ToUnixTimeSeconds() / 3600 * 3600 + 3600;
        return $"/api/files/{mediaId:N}?exp={exp.ToString(CultureInfo.InvariantCulture)}&sig={Sig(mediaId, exp)}";
    }

    public bool Validate(Guid mediaId, long expiresUnix, string signature) =>
        expiresUnix > DateTimeOffset.UtcNow.ToUnixTimeSeconds() && signature is { Length: 32 } &&
        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Sig(mediaId, expiresUnix)), Encoding.ASCII.GetBytes(signature));
}
