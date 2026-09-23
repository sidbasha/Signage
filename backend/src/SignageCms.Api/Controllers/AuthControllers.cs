using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SignageCms.Api.Infrastructure;
using SignageCms.Application.Common;
using SignageCms.Application.Services;

namespace SignageCms.Api.Controllers;

[ApiController, Route("api/auth"), EnableRateLimiting("auth")]
public class AuthController : ControllerBase
{
    private readonly AuthService _auth;
    public AuthController(AuthService auth) => _auth = auth;

    [HttpPost("register"), AllowAnonymous]
    public Task<AuthResponse> Register(RegisterRequest r, CancellationToken ct) => _auth.RegisterAsync(r, ct);

    [HttpPost("login"), AllowAnonymous]
    public Task<AuthResponse> Login(LoginRequest r, CancellationToken ct) => _auth.LoginAsync(r, ct);

    [HttpPost("refresh"), AllowAnonymous]
    public Task<AuthResponse> Refresh(RefreshRequest r, CancellationToken ct) => _auth.RefreshAsync(r.RefreshToken, ct);

    [HttpPost("logout"), AllowAnonymous]
    public async Task<IActionResult> Logout(RefreshRequest r, CancellationToken ct) { await _auth.LogoutAsync(r.RefreshToken, ct); return NoContent(); }

    [HttpGet("me"), Authorize]
    public Task<MeDto> Me(CancellationToken ct) => _auth.MeAsync(ct);
}

[ApiController, Route("api/users")]
public class UsersController : ControllerBase
{
    private readonly UserService _s;
    public UsersController(UserService s) => _s = s;
    [HttpGet, HasPermission(Permissions.UsersView)] public Task<List<UserDto>> List(CancellationToken ct) => _s.ListAsync(ct);
    [HttpGet("{id:guid}"), HasPermission(Permissions.UsersView)] public Task<UserDto> Get(Guid id, CancellationToken ct) => _s.GetAsync(id, ct);
    [HttpPost, HasPermission(Permissions.UsersManage)] public Task<UserDto> Create(CreateUserRequest r, CancellationToken ct) => _s.CreateAsync(r, ct);
    [HttpPut("{id:guid}"), HasPermission(Permissions.UsersManage)] public Task<UserDto> Update(Guid id, UpdateUserRequest r, CancellationToken ct) => _s.UpdateAsync(id, r, ct);
    [HttpDelete("{id:guid}"), HasPermission(Permissions.UsersManage)] public async Task<IActionResult> Delete(Guid id, CancellationToken ct) { await _s.DeleteAsync(id, ct); return NoContent(); }
}

[ApiController, Route("api/roles")]
public class RolesController : ControllerBase
{
    private readonly RoleService _s;
    public RolesController(RoleService s) => _s = s;
    [HttpGet, HasPermission(Permissions.UsersView)] public Task<List<RoleDto>> List(CancellationToken ct) => _s.ListAsync(ct);
    [HttpGet("/api/permissions"), HasPermission(Permissions.UsersView)] public List<PermissionDto> AllPermissions() => _s.AllPermissions();
    [HttpPost, HasPermission(Permissions.RolesManage)] public Task<RoleDto> Create(SaveRoleRequest r, CancellationToken ct) => _s.CreateAsync(r, ct);
    [HttpPut("{id:guid}"), HasPermission(Permissions.RolesManage)] public Task<RoleDto> Update(Guid id, SaveRoleRequest r, CancellationToken ct) => _s.UpdateAsync(id, r, ct);
    [HttpDelete("{id:guid}"), HasPermission(Permissions.RolesManage)] public async Task<IActionResult> Delete(Guid id, CancellationToken ct) { await _s.DeleteAsync(id, ct); return NoContent(); }
}

[ApiController, Route("api/organization")]
public class OrganizationController : ControllerBase
{
    private readonly OrganizationService _s;
    public OrganizationController(OrganizationService s) => _s = s;
    [HttpGet, Authorize] public Task<OrganizationDto> Get(CancellationToken ct) => _s.GetAsync(ct);
    [HttpPut, HasPermission(Permissions.OrganizationManage)] public Task<OrganizationDto> Update(UpdateOrganizationRequest r, CancellationToken ct) => _s.UpdateAsync(r, ct);
    [HttpGet("/api/subscription"), HasPermission(Permissions.SubscriptionView)] public Task<SubscriptionDto> Subscription(CancellationToken ct) => _s.SubscriptionAsync(ct);
    [HttpPut("/api/subscription"), HasPermission(Permissions.SubscriptionManage)] public Task<SubscriptionDto> ChangePlan(ChangePlanRequest r, CancellationToken ct) => _s.ChangePlanAsync(r, ct);
    [HttpGet("/api/dashboard"), HasPermission(Permissions.DashboardView)] public Task<DashboardDto> Dashboard(CancellationToken ct) => _s.DashboardAsync(ct);
    [HttpGet("/api/timezones"), Authorize] public IEnumerable<string> TimeZones() =>
        TimeZoneInfo.GetSystemTimeZones().Select(t => t.Id).Where(id => id.Contains('/') || id == "UTC").OrderBy(x => x);
}

[ApiController, Route("api/notifications")]
public class NotificationsController : ControllerBase
{
    private readonly NotificationService _s;
    public NotificationsController(NotificationService s) => _s = s;
    [HttpGet, Authorize] public Task<object> List([FromQuery] bool unreadOnly, [FromQuery] int take = 50, CancellationToken ct = default) => _s.ListAsync(unreadOnly, take, ct);
    [HttpPost("{id:guid}/read"), Authorize] public async Task<IActionResult> Read(Guid id, CancellationToken ct) { await _s.MarkReadAsync(id, ct); return NoContent(); }
    [HttpPost("read-all"), Authorize] public async Task<object> ReadAll(CancellationToken ct) => new { updated = await _s.MarkAllReadAsync(ct) };
}

[ApiController, Route("api/audit-logs")]
public class AuditLogsController : ControllerBase
{
    private readonly AuditService _s;
    public AuditLogsController(AuditService s) => _s = s;
    [HttpGet, HasPermission(Permissions.AuditView)]
    public Task<PagedResult<AuditLogDto>> List([FromQuery] int page = 1, [FromQuery] int pageSize = 50, [FromQuery] string? entityType = null, [FromQuery] string? search = null, CancellationToken ct = default)
        => _s.ListAsync(page, pageSize, entityType, search, ct);
}
