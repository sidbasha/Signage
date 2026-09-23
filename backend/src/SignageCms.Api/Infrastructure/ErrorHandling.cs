using Microsoft.AspNetCore.Mvc;
using SignageCms.Application.Common;

namespace SignageCms.Api.Infrastructure;

/// <summary>
/// Maps application exceptions to RFC 7807 problem details. Expected outcomes (validation, 404, 403, quota)
/// are not logged as errors; only genuine 5xx failures are.
/// </summary>
public class ErrorHandlingMiddleware
{
    private readonly RequestDelegate _next; private readonly ILogger<ErrorHandlingMiddleware> _log; private readonly IHostEnvironment _env;
    public ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> log, IHostEnvironment env) { _next = next; _log = log; _env = env; }

    public async Task Invoke(HttpContext ctx)
    {
        try { await _next(ctx); }
        catch (Exception ex) when (!ctx.Response.HasStarted)
        {
            var (status, title) = ex switch
            {
                ValidationException => (400, "Validation failed"),
                NotFoundException => (404, "Not found"),
                ConflictException => (409, "Conflict"),
                ForbiddenException => (403, "Forbidden"),
                UnauthorizedException => (401, "Unauthorized"),
                QuotaExceededException => (402, "Plan limit reached"),
                BadHttpRequestException b => (b.StatusCode, "Bad request"),
                OperationCanceledException when ctx.RequestAborted.IsCancellationRequested => (499, "Client closed request"),
                _ => (500, "Unexpected error"),
            };
            if (status == 500) _log.LogError(ex, "Unhandled error on {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
            else _log.LogDebug("{Status} on {Method} {Path}: {Message}", status, ctx.Request.Method, ctx.Request.Path, ex.Message);
            if (status == 499) return;

            var problem = new ProblemDetails
            {
                Status = status, Title = title, Instance = ctx.Request.Path,
                Detail = ex is AppException or BadHttpRequestException ? ex.Message
                    : _env.IsDevelopment() ? ex.ToString() : "Something went wrong. Try again, and contact support if it keeps happening.",
            };
            if (ex is ValidationException v) problem.Extensions["errors"] = v.Errors;
            problem.Extensions["traceId"] = ctx.TraceIdentifier;
            ctx.Response.Clear();
            ctx.Response.StatusCode = status;
            await ctx.Response.WriteAsJsonAsync(problem, (System.Text.Json.JsonSerializerOptions?)null, "application/problem+json");
        }
    }
}
