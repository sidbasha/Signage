using Microsoft.AspNetCore.Mvc;
using SignageCms.Api.Infrastructure;
using SignageCms.Application.Common;
using SignageCms.Application.Services;

namespace SignageCms.Api.Controllers;

[ApiController, Route("api/locations")]
public class LocationsController : ControllerBase
{
    private readonly LocationService _s;
    public LocationsController(LocationService s) => _s = s;
    [HttpGet, HasPermission(Permissions.LocationsView)] public Task<List<LocationDto>> List(CancellationToken ct) => _s.ListAsync(ct);
    [HttpPost, HasPermission(Permissions.LocationsManage)] public Task<LocationDto> Create(SaveLocationRequest r, CancellationToken ct) => _s.CreateAsync(r, ct);
    [HttpPut("{id:guid}"), HasPermission(Permissions.LocationsManage)] public Task<LocationDto> Update(Guid id, SaveLocationRequest r, CancellationToken ct) => _s.UpdateAsync(id, r, ct);
    [HttpDelete("{id:guid}"), HasPermission(Permissions.LocationsManage)] public async Task<IActionResult> Delete(Guid id, CancellationToken ct) { await _s.DeleteAsync(id, ct); return NoContent(); }
}

[ApiController, Route("api/devices")]
public class DevicesController : ControllerBase
{
    private readonly DeviceService _s;
    public DevicesController(DeviceService s) => _s = s;
    [HttpGet, HasPermission(Permissions.DevicesView)]
    public Task<List<DeviceDto>> List([FromQuery] Guid? locationId, [FromQuery] Guid? groupId, [FromQuery] string? status, CancellationToken ct) => _s.ListAsync(locationId, groupId, status, ct);
    [HttpGet("{id:guid}"), HasPermission(Permissions.DevicesView)] public Task<DeviceDto> Get(Guid id, CancellationToken ct) => _s.GetAsync(id, ct);
    [HttpGet("{id:guid}/playback"), HasPermission(Permissions.DevicesView)] public Task<object> Playback(Guid id, [FromQuery] int days = 7, CancellationToken ct = default) => _s.PlaybackAsync(id, days, ct);
    [HttpPost("pair"), HasPermission(Permissions.DevicesPair)] public Task<DeviceDto> Pair(PairDeviceRequest r, CancellationToken ct) => _s.PairAsync(r, ct);
    [HttpPut("{id:guid}"), HasPermission(Permissions.DevicesManage)] public Task<DeviceDto> Update(Guid id, UpdateDeviceRequest r, CancellationToken ct) => _s.UpdateAsync(id, r, ct);
    [HttpDelete("{id:guid}"), HasPermission(Permissions.DevicesManage)] public async Task<IActionResult> Delete(Guid id, CancellationToken ct) { await _s.DeleteAsync(id, ct); return NoContent(); }
    [HttpPost("{id:guid}/commands"), HasPermission(Permissions.DevicesCommand)] public async Task<IActionResult> Command(Guid id, DeviceCommandRequest r, CancellationToken ct) { await _s.SendCommandAsync(id, r, ct); return Accepted(); }
}

[ApiController, Route("api/device-groups")]
public class DeviceGroupsController : ControllerBase
{
    private readonly DeviceGroupService _s;
    public DeviceGroupsController(DeviceGroupService s) => _s = s;
    [HttpGet, HasPermission(Permissions.DevicesView)] public Task<List<DeviceGroupDto>> List(CancellationToken ct) => _s.ListAsync(ct);
    [HttpGet("{id:guid}"), HasPermission(Permissions.DevicesView)] public Task<DeviceGroupDto> Get(Guid id, CancellationToken ct) => _s.GetAsync(id, ct);
    [HttpPost, HasPermission(Permissions.GroupsManage)] public Task<DeviceGroupDto> Create(SaveDeviceGroupRequest r, CancellationToken ct) => _s.CreateAsync(r, ct);
    [HttpPut("{id:guid}"), HasPermission(Permissions.GroupsManage)] public Task<DeviceGroupDto> Update(Guid id, SaveDeviceGroupRequest r, CancellationToken ct) => _s.UpdateAsync(id, r, ct);
    [HttpDelete("{id:guid}"), HasPermission(Permissions.GroupsManage)] public async Task<IActionResult> Delete(Guid id, CancellationToken ct) { await _s.DeleteAsync(id, ct); return NoContent(); }
}
