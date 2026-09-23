using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;

namespace SignageCms.Application.Services;

public record RegisterRequest(string OrganizationName, string FullName, string Email, string Password, string? TimeZone);
public record LoginRequest(string Email, string Password);
public record RefreshRequest(string RefreshToken);
public record AuthResponse(string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken, DateTime RefreshTokenExpiresAt, MeDto User);
public record MeDto(Guid Id, string Email, string FullName, Guid OrganizationId, string OrganizationName, string[] Roles, string[] Permissions);

public class AuthService
{
    public static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(14);
    private readonly IAppDbContext _db; private readonly IPasswordHasher _hasher; private readonly ITokenService _tokens;
    private readonly IClock _clock; private readonly ICurrentUser _current; private readonly OrganizationProvisioner _provisioner; private readonly AuditService _audit;

    public AuthService(IAppDbContext db, IPasswordHasher hasher, ITokenService tokens, IClock clock, ICurrentUser current,
        OrganizationProvisioner provisioner, AuditService audit)
    { _db = db; _hasher = hasher; _tokens = tokens; _clock = clock; _current = current; _provisioner = provisioner; _audit = audit; }

    public static void ValidatePassword(Validator v, string? password) =>
        v.Check(password is { Length: >= 8 } && password.Any(char.IsDigit) && password.Any(char.IsLetter),
            "password", "Password must be at least 8 characters and include a letter and a number.");

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    public async Task<AuthResponse> RegisterAsync(RegisterRequest r, CancellationToken ct)
    {
        var v = new Validator().Require("organizationName", r.OrganizationName, 120).Require("fullName", r.FullName, 120).Require("email", r.Email, 200);
        v.Check(r.Email?.Contains('@') == true, "email", "Enter a valid email address.");
        ValidatePassword(v, r.Password);
        v.ThrowIfInvalid();
        var email = NormalizeEmail(r.Email);
        if (await _db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email == email, ct))
            throw new ConflictException("An account with this email already exists.");

        var (org, roles) = _provisioner.Provision(r.OrganizationName, string.IsNullOrWhiteSpace(r.TimeZone) ? "UTC" : r.TimeZone!);
        var user = new User { OrganizationId = org.Id, Email = email, FullName = r.FullName.Trim(), PasswordHash = _hasher.Hash(r.Password) };
        user.UserRoles.Add(new UserRole { UserId = user.Id, RoleId = roles["Owner"].Id });
        _db.Users.Add(user);
        _audit.Record("organization.registered", "Organization", org.Id, $"Organization '{org.Name}' created by {email}", org.Id);
        await _db.SaveChangesAsync(ct);
        return await IssueAsync(user.Id, ct);
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest r, CancellationToken ct)
    {
        var email = NormalizeEmail(r.Email ?? "");
        var user = await _db.Users.IgnoreQueryFilters().Include(u => u.Organization).FirstOrDefaultAsync(u => u.Email == email, ct);
        if (user is null || !_hasher.Verify(user.PasswordHash, r.Password ?? ""))
            throw new UnauthorizedException("Email or password is incorrect.");
        if (!user.IsActive || user.Organization?.IsActive != true)
            throw new UnauthorizedException("This account is disabled. Contact your administrator.");
        user.LastLoginAt = _clock.UtcNow;
        _db.AuditLogs.Add(new AuditLog { OrganizationId = user.OrganizationId, UserId = user.Id, UserEmail = user.Email, Action = "user.login",
            EntityType = "User", EntityId = user.Id.ToString(), Summary = "Signed in", IpAddress = _current.IpAddress });
        await _db.SaveChangesAsync(ct);
        return await IssueAsync(user.Id, ct);
    }

    public async Task<AuthResponse> RefreshAsync(string refreshToken, CancellationToken ct)
    {
        var hash = Crypto.Sha256(refreshToken ?? "");
        var token = await _db.RefreshTokens.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (token is null) throw new UnauthorizedException("Session expired. Sign in again.");
        if (!token.IsActive(_clock.UtcNow))
        {
            // Reuse of a rotated token indicates theft: revoke every session of this user.
            if (token.ReplacedById != null)
                await _db.RefreshTokens.IgnoreQueryFilters().Where(t => t.UserId == token.UserId && t.RevokedAt == null)
                    .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, _clock.UtcNow), ct);
            throw new UnauthorizedException("Session expired. Sign in again.");
        }
        var result = await IssueAsync(token.UserId, ct, token);
        return result;
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken ct)
    {
        var hash = Crypto.Sha256(refreshToken ?? "");
        await _db.RefreshTokens.IgnoreQueryFilters().Where(t => t.TokenHash == hash && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, _clock.UtcNow), ct);
    }

    public async Task<MeDto> MeAsync(CancellationToken ct)
    {
        var id = _current.UserId ?? throw new UnauthorizedException("Not signed in.");
        return (await LoadAsync(id, ct)).Me;
    }

    private async Task<(User User, MeDto Me)> LoadAsync(Guid userId, CancellationToken ct)
    {
        var user = await _db.Users.IgnoreQueryFilters().Include(u => u.Organization)
            .Include(u => u.UserRoles).ThenInclude(ur => ur.Role!).ThenInclude(r => r.Permissions)
            .FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw new UnauthorizedException("Account not found.");
        if (!user.IsActive) throw new UnauthorizedException("This account is disabled.");
        var roles = user.UserRoles.Select(ur => ur.Role!.Name).OrderBy(x => x).ToArray();
        var perms = user.UserRoles.SelectMany(ur => ur.Role!.Permissions.Select(p => p.PermissionCode)).Distinct().OrderBy(x => x).ToArray();
        return (user, new MeDto(user.Id, user.Email, user.FullName, user.OrganizationId, user.Organization!.Name, roles, perms));
    }

    private async Task<AuthResponse> IssueAsync(Guid userId, CancellationToken ct, RefreshToken? rotating = null)
    {
        var (user, me) = await LoadAsync(userId, ct);
        var access = _tokens.CreateAccessToken(user, me.OrganizationName, me.Roles, me.Permissions);
        var raw = Crypto.RandomToken(48);
        var rt = new RefreshToken { UserId = user.Id, TokenHash = Crypto.Sha256(raw), ExpiresAt = _clock.UtcNow.Add(RefreshLifetime), CreatedByIp = _current.IpAddress };
        _db.RefreshTokens.Add(rt);
        if (rotating != null) { rotating.RevokedAt = _clock.UtcNow; rotating.ReplacedById = rt.Id; }
        await _db.SaveChangesAsync(ct);
        return new AuthResponse(access.Token, access.ExpiresAt, raw, rt.ExpiresAt, me);
    }
}
