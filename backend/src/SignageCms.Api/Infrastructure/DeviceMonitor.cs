using SignageCms.Application.Services;

namespace SignageCms.Api.Infrastructure;

/// <summary>Marks devices offline when they stop sending heartbeats (e.g. power loss without a clean disconnect).</summary>
public class DeviceMonitor : BackgroundService
{
    private readonly IServiceScopeFactory _scopes; private readonly ILogger<DeviceMonitor> _log;
    public DeviceMonitor(IServiceScopeFactory scopes, ILogger<DeviceMonitor> log) { _scopes = scopes; _log = log; }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var n = await scope.ServiceProvider.GetRequiredService<DeviceSyncService>().SweepStaleDevicesAsync(ct);
                if (n > 0) _log.LogInformation("Marked {Count} device(s) offline", n);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested) { _log.LogError(ex, "Device sweep failed"); }
        } while (await timer.WaitForNextTickAsync(ct));
    }
}
