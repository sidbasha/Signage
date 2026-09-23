using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SignageCms.Api.Infrastructure;
using SignageCms.Application.Services;

namespace SignageCms.Api.Controllers;

/// <summary>Unauthenticated endpoints an unpaired player uses to get a pairing code and, once claimed, its device key.</summary>
[ApiController, Route("api/pairing"), AllowAnonymous, EnableRateLimiting("pairing")]
public class PairingController : ControllerBase
{
    private readonly PairingService _s;
    public PairingController(PairingService s) => _s = s;
    [HttpPost] public Task<PairingCreatedDto> Create(CreatePairingRequest r, CancellationToken ct) => _s.CreateAsync(r, ct);
    [HttpGet("{id:guid}")] public Task<PairingStatusDto> Status(Guid id, [FromHeader(Name = "X-Poll-Secret")] string secret, CancellationToken ct) => _s.StatusAsync(id, secret, ct);
}

/// <summary>Endpoints for paired players, authenticated with "Authorization: Device &lt;key&gt;".</summary>
[ApiController, Route("api/player"), Authorize(AuthenticationSchemes = DeviceAuthenticationHandler.Scheme)]
public class PlayerController : ControllerBase
{
    private readonly DeviceSyncService _s;
    public PlayerController(DeviceSyncService s) => _s = s;

    /// <summary>Full offline manifest. Supports If-None-Match so unchanged content costs one small round-trip.</summary>
    [HttpGet("manifest")]
    public async Task<IActionResult> Manifest(CancellationToken ct)
    {
        var m = await _s.BuildManifestAsync(ct);
        await _s.TouchSyncAsync(ct);
        var etag = $"\"{m.Version}\"";
        Response.Headers.ETag = etag;
        Response.Headers.CacheControl = "no-cache";
        if (Request.Headers.IfNoneMatch.ToString() == etag) return StatusCode(304);
        return Ok(m);
    }

    [HttpPost("heartbeat")]
    public async Task<IActionResult> Heartbeat(HeartbeatRequest r, CancellationToken ct) { await _s.HeartbeatAsync(r, ct); return NoContent(); }

    [HttpPost("playback")]
    public async Task<IActionResult> Playback(PlaybackEntry[] entries, CancellationToken ct) { await _s.RecordPlaybackAsync(entries, ct); return NoContent(); }
}
