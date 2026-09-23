using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using SignageCms.Api.Infrastructure;
using SignageCms.Application.Common;
using SignageCms.Application.Services;
using SignageCms.Infrastructure.Security;

namespace SignageCms.Api.Hubs;

/// <summary>Admin UI channel: live device status and notifications for one organization.</summary>
[Authorize(AuthenticationSchemes = JwtBearerDefaults.AuthenticationScheme)]
public class AdminHub : Hub
{
    public static string OrgGroup(Guid orgId) => $"org:{orgId:N}";
    public override async Task OnConnectedAsync()
    {
        var org = Context.User?.FindFirst(AppClaims.Organization)?.Value;
        if (Guid.TryParse(org, out var id)) await Groups.AddToGroupAsync(Context.ConnectionId, OrgGroup(id));
        await base.OnConnectedAsync();
    }
}

/// <summary>Player channel: receives content-changed and command messages; presence drives online/offline status.</summary>
[Authorize(AuthenticationSchemes = DeviceAuthenticationHandler.Scheme)]
public class DeviceHub : Hub
{
    public static string DeviceGroup(Guid id) => $"device:{id:N}";
    public static string OrgDevicesGroup(Guid orgId) => $"org-devices:{orgId:N}";
    private readonly DeviceSyncService _sync; private readonly ICurrentUser _caller;
    public DeviceHub(DeviceSyncService sync, ICurrentUser caller) { _sync = sync; _caller = caller; }

    // Connection count per device on this node, so a quick reconnect (page reload) doesn't flap the status.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, int> Connections = new();

    public override async Task OnConnectedAsync()
    {
        Connections.AddOrUpdate(_caller.DeviceId!.Value, 1, (_, n) => n + 1);
        await Groups.AddToGroupAsync(Context.ConnectionId, DeviceGroup(_caller.DeviceId!.Value));
        await Groups.AddToGroupAsync(Context.ConnectionId, OrgDevicesGroup(_caller.OrganizationId!.Value));
        await _sync.SetConnectedAsync(true, Context.ConnectionAborted);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var left = Connections.AddOrUpdate(_caller.DeviceId!.Value, 0, (_, n) => Math.Max(0, n - 1));
        if (left == 0) await _sync.SetConnectedAsync(false, CancellationToken.None);
        await base.OnDisconnectedAsync(exception);
    }

    public async Task Heartbeat(HeartbeatRequest status)
    {
        try { await _sync.HeartbeatAsync(status, Context.ConnectionAborted); }
        catch (UnauthorizedException) { Context.Abort(); } // device was unpaired: drop the connection quietly; the player also received "Revoked"
        catch (OperationCanceledException) when (Context.ConnectionAborted.IsCancellationRequested) { } // connection already closing
    }
}

public class SignalRNotifier : IRealtimeNotifier
{
    private readonly IHubContext<AdminHub> _admin; private readonly IHubContext<DeviceHub> _devices;
    public SignalRNotifier(IHubContext<AdminHub> admin, IHubContext<DeviceHub> devices) { _admin = admin; _devices = devices; }

    public Task ContentChangedAsync(Guid organizationId) =>
        _devices.Clients.Group(DeviceHub.OrgDevicesGroup(organizationId)).SendAsync("ContentChanged");
    public Task DeviceStatusChangedAsync(Guid organizationId, object payload) =>
        _admin.Clients.Group(AdminHub.OrgGroup(organizationId)).SendAsync("DeviceStatus", payload);
    public Task NotificationCreatedAsync(Guid organizationId, object payload) =>
        _admin.Clients.Group(AdminHub.OrgGroup(organizationId)).SendAsync("Notification", payload);
    public Task SendDeviceCommandAsync(Guid deviceId, string command, object? payload = null) =>
        _devices.Clients.Group(DeviceHub.DeviceGroup(deviceId)).SendAsync("Command", new { command, payload });
    public Task DeviceRevokedAsync(Guid deviceId) =>
        _devices.Clients.Group(DeviceHub.DeviceGroup(deviceId)).SendAsync("Revoked");
}
