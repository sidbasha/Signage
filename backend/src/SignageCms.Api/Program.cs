using System.Text;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using SignageCms.Api.Hubs;
using SignageCms.Api.Infrastructure;
using SignageCms.Application;
using SignageCms.Application.Common;
using SignageCms.Infrastructure;
using SignageCms.Infrastructure.Persistence;
using SignageCms.Infrastructure.Security;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

var jwt = config.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (Encoding.UTF8.GetByteCount(jwt.SigningKey) < 32)
    throw new InvalidOperationException("Jwt:SigningKey must be at least 32 bytes. Set it with the Jwt__SigningKey environment variable.");

builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = SignageCms.Api.Controllers.MediaController.MaxUploadBytes);

builder.Services.AddApplication().AddInfrastructure(config);
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, HttpCurrentUser>();
builder.Services.AddSingleton<IRealtimeNotifier, SignalRNotifier>();
builder.Services.AddHostedService<DeviceMonitor>();
builder.Services.AddProblemDetails();

builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSignalR().AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Issuer, ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
            ValidateIssuerSigningKey = true, ValidateLifetime = true, ClockSkew = TimeSpan.FromSeconds(30),
            NameClaimType = "name", RoleClaimType = System.Security.Claims.ClaimTypes.Role,
        };
        o.Events = new JwtBearerEvents
        {
            // Browsers can't set headers on WebSocket connections; SignalR sends the token as a query parameter.
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs/admin")) ctx.Token = token;
                return Task.CompletedTask;
            },
        };
    })
    .AddScheme<AuthenticationSchemeOptions, DeviceAuthenticationHandler>(DeviceAuthenticationHandler.Scheme, null);

builder.Services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
builder.Services.AddSingleton<IAuthorizationHandler, PermissionHandler>();
builder.Services.AddAuthorization();

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("pairing", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1) }));
});

var origins = config.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials().WithExposedHeaders("ETag")));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(o =>
{
    o.SwaggerDoc("v1", new OpenApiInfo { Title = "Signage CMS API", Version = "v1", Description = "Admin API (JWT) and player API (Device key)." });
    o.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme { Type = SecuritySchemeType.Http, Scheme = "bearer", BearerFormat = "JWT", Description = "Admin access token" });
    o.AddSecurityDefinition("Device", new OpenApiSecurityScheme { Type = SecuritySchemeType.ApiKey, In = ParameterLocation.Header, Name = "Authorization", Description = "Player key: \"Device <key>\"" });
    o.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        [new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" } }] = Array.Empty<string>(),
    });
    o.CustomSchemaIds(t => t.FullName!.Replace("SignageCms.Application.Services.", "").Replace("+", "."));
});
builder.Services.AddHealthChecks();

var app = builder.Build();

app.UseForwardedHeaders(new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto });
app.UseMiddleware<ErrorHandlingMiddleware>();
app.UseStatusCodePages();
if (config.GetValue("Swagger:Enabled", true))
{
    app.UseSwagger();
    app.UseSwaggerUI(o => o.DocumentTitle = "Signage CMS API");
}
app.UseDefaultFiles();
var contentTypes = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
contentTypes.Mappings[".apk"] = "application/vnd.android.package-archive"; // Android player download
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = contentTypes }); // production: built admin UI + web player live in wwwroot
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<AdminHub>("/hubs/admin");
app.MapHub<DeviceHub>("/hubs/device");
app.MapHealthChecks("/health");
app.MapFallbackToFile("index.html"); // SPA routes

// The database may come up after the API (containers, reboots): retry instead of crashing.
for (var attempt = 1; ; attempt++)
{
    try
    {
        using var scope = app.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<DbSeeder>().SeedAsync();
        break;
    }
    catch (Exception ex) when (attempt < 10 && ex is Npgsql.NpgsqlException or System.Net.Sockets.SocketException or InvalidOperationException { InnerException: Npgsql.NpgsqlException })
    {
        app.Logger.LogWarning("Database not reachable (attempt {Attempt}/10): {Message}. Retrying in 3s.", attempt, ex.Message);
        await Task.Delay(TimeSpan.FromSeconds(3));
    }
}

app.Run();

public partial class Program { }
