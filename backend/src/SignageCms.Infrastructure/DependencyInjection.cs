using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SignageCms.Application.Common;
using SignageCms.Infrastructure.Persistence;
using SignageCms.Infrastructure.Security;
using SignageCms.Infrastructure.Storage;

namespace SignageCms.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        var cs = config.GetConnectionString("Default") ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.");
        services.AddDbContext<AppDbContext>(o => o.UseNpgsql(cs, npg => npg.EnableRetryOnFailure(3)));
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<AppDbContext>());
        services.Configure<JwtOptions>(config.GetSection("Jwt"));
        services.Configure<StorageOptions>(config.GetSection("Storage"));
        services.AddSingleton<ITokenService, JwtTokenService>();
        services.AddSingleton<IPasswordHasher, IdentityPasswordHasher>();
        services.AddSingleton<IUrlSigner, HmacUrlSigner>();
        services.AddSingleton<IFileStorage, LocalFileStorage>();
        services.AddScoped<DbSeeder>();
        return services;
    }
}
