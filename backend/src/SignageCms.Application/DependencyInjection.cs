using Microsoft.Extensions.DependencyInjection;
using SignageCms.Application.Common;
using SignageCms.Application.Services;

namespace SignageCms.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddSingleton<IClock, SystemClock>();
        services.AddScoped<AuditService>();
        services.AddScoped<NotificationService>();
        services.AddScoped<OrganizationProvisioner>();
        services.AddScoped<AuthService>();
        services.AddScoped<UserService>();
        services.AddScoped<RoleService>();
        services.AddScoped<LocationService>();
        services.AddScoped<OrganizationService>();
        services.AddScoped<MediaService>();
        services.AddScoped<PlaylistService>();
        services.AddScoped<LayoutService>();
        services.AddScoped<ScheduleService>();
        services.AddScoped<DeviceService>();
        services.AddScoped<DeviceGroupService>();
        services.AddScoped<PairingService>();
        services.AddScoped<DeviceSyncService>();
        return services;
    }
}
