using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SignageCms.Api.Infrastructure;
using SignageCms.Application.Common;
using SignageCms.Application.Services;

namespace SignageCms.Api.Controllers;

[ApiController, Route("api/media")]
public class MediaController : ControllerBase
{
    public const long MaxUploadBytes = 1024L * 1024 * 1024; // 1 GB per file
    private readonly MediaService _s;
    public MediaController(MediaService s) => _s = s;

    [HttpGet, HasPermission(Permissions.MediaView)] public Task<List<MediaDto>> List([FromQuery] string? search, [FromQuery] string? type, CancellationToken ct) => _s.ListAsync(search, type, ct);
    [HttpGet("{id:guid}"), HasPermission(Permissions.MediaView)] public Task<MediaDto> Get(Guid id, CancellationToken ct) => _s.GetAsync(id, ct);

    [HttpPost, HasPermission(Permissions.MediaManage), RequestSizeLimit(MaxUploadBytes), RequestFormLimits(MultipartBodyLengthLimit = MaxUploadBytes)]
    public async Task<MediaDto> Upload(IFormFile file, [FromForm] string? name, [FromForm] int? width, [FromForm] int? height,
        [FromForm] int? durationSeconds, [FromForm] string? tags, CancellationToken ct)
    {
        if (file is null) throw new ValidationException("file", "Choose a file to upload.");
        await using var stream = file.OpenReadStream();
        return await _s.UploadAsync(new UploadMediaCommand(stream, file.FileName, file.ContentType, file.Length, name, width, height, durationSeconds, tags), ct);
    }

    [HttpPost("web"), HasPermission(Permissions.MediaManage)] public Task<MediaDto> CreateWeb(CreateWebMediaRequest r, CancellationToken ct) => _s.CreateWebAsync(r, ct);
    [HttpPut("{id:guid}"), HasPermission(Permissions.MediaManage)] public Task<MediaDto> Update(Guid id, UpdateMediaRequest r, CancellationToken ct) => _s.UpdateAsync(id, r, ct);
    [HttpDelete("{id:guid}"), HasPermission(Permissions.MediaManage)] public async Task<IActionResult> Delete(Guid id, CancellationToken ct) { await _s.DeleteAsync(id, ct); return NoContent(); }
}

/// <summary>Serves media via signed URLs, with HTTP range support for video seeking and resumable downloads.</summary>
[ApiController, Route("api/files")]
public class FilesController : ControllerBase
{
    private readonly MediaService _s;
    public FilesController(MediaService s) => _s = s;

    [HttpGet("{id:guid}"), AllowAnonymous, ResponseCache(Duration = 86400, Location = ResponseCacheLocation.Client)]
    public async Task<IActionResult> Get(Guid id, [FromQuery] long exp, [FromQuery] string sig, CancellationToken ct)
    {
        var (path, mime, _) = await _s.ResolveSignedAsync(id, exp, sig, ct);
        if (!System.IO.File.Exists(path)) return NotFound();
        return PhysicalFile(path, mime, enableRangeProcessing: true);
    }
}

[ApiController, Route("api/playlists")]
public class PlaylistsController : ControllerBase
{
    private readonly PlaylistService _s;
    public PlaylistsController(PlaylistService s) => _s = s;
    [HttpGet, HasPermission(Permissions.PlaylistsView)] public Task<List<PlaylistDto>> List(CancellationToken ct) => _s.ListAsync(ct);
    [HttpGet("{id:guid}"), HasPermission(Permissions.PlaylistsView)] public Task<PlaylistDto> Get(Guid id, CancellationToken ct) => _s.GetAsync(id, ct);
    [HttpPost, HasPermission(Permissions.PlaylistsManage)] public Task<PlaylistDto> Create(SavePlaylistRequest r, CancellationToken ct) => _s.CreateAsync(r, ct);
    [HttpPut("{id:guid}"), HasPermission(Permissions.PlaylistsManage)] public Task<PlaylistDto> Update(Guid id, SavePlaylistRequest r, CancellationToken ct) => _s.UpdateAsync(id, r, ct);
    [HttpDelete("{id:guid}"), HasPermission(Permissions.PlaylistsManage)] public async Task<IActionResult> Delete(Guid id, CancellationToken ct) { await _s.DeleteAsync(id, ct); return NoContent(); }
}

[ApiController, Route("api/layouts")]
public class LayoutsController : ControllerBase
{
    private readonly LayoutService _s;
    public LayoutsController(LayoutService s) => _s = s;
    [HttpGet, HasPermission(Permissions.LayoutsView)] public Task<List<LayoutDto>> List(CancellationToken ct) => _s.ListAsync(false, ct);
    [HttpGet("templates"), HasPermission(Permissions.LayoutsView)] public Task<List<LayoutDto>> Templates(CancellationToken ct) => _s.ListAsync(true, ct);
    [HttpGet("{id:guid}"), HasPermission(Permissions.LayoutsView)] public Task<LayoutDto> Get(Guid id, CancellationToken ct) => _s.GetAsync(id, ct);
    [HttpPost, HasPermission(Permissions.LayoutsManage)] public Task<LayoutDto> Create(SaveLayoutRequest r, CancellationToken ct) => _s.CreateAsync(r, ct);
    [HttpPost("from-template/{templateId:guid}"), HasPermission(Permissions.LayoutsManage)] public Task<LayoutDto> FromTemplate(Guid templateId, FromTemplateRequest r, CancellationToken ct) => _s.FromTemplateAsync(templateId, r, ct);
    [HttpPut("{id:guid}"), HasPermission(Permissions.LayoutsManage)] public Task<LayoutDto> Update(Guid id, SaveLayoutRequest r, CancellationToken ct) => _s.UpdateAsync(id, r, ct);
    [HttpDelete("{id:guid}"), HasPermission(Permissions.LayoutsManage)] public async Task<IActionResult> Delete(Guid id, CancellationToken ct) { await _s.DeleteAsync(id, ct); return NoContent(); }
}

[ApiController, Route("api/schedules")]
public class SchedulesController : ControllerBase
{
    private readonly ScheduleService _s;
    public SchedulesController(ScheduleService s) => _s = s;
    [HttpGet, HasPermission(Permissions.SchedulesView)] public Task<List<ScheduleDto>> List(CancellationToken ct) => _s.ListAsync(ct);
    [HttpGet("{id:guid}"), HasPermission(Permissions.SchedulesView)] public Task<ScheduleDto> Get(Guid id, CancellationToken ct) => _s.GetAsync(id, ct);
    [HttpPost, HasPermission(Permissions.SchedulesManage)] public Task<ScheduleDto> Create(SaveScheduleRequest r, CancellationToken ct) => _s.CreateAsync(r, ct);
    [HttpPut("{id:guid}"), HasPermission(Permissions.SchedulesManage)] public Task<ScheduleDto> Update(Guid id, SaveScheduleRequest r, CancellationToken ct) => _s.UpdateAsync(id, r, ct);
    [HttpDelete("{id:guid}"), HasPermission(Permissions.SchedulesManage)] public async Task<IActionResult> Delete(Guid id, CancellationToken ct) { await _s.DeleteAsync(id, ct); return NoContent(); }
}
