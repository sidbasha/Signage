namespace SignageCms.Application.Common;

public class AppException : Exception
{
    public AppException(string message) : base(message) { }
}
public class NotFoundException : AppException
{
    public NotFoundException(string entity, object? key = null)
        : base(key is null ? $"{entity} was not found." : $"{entity} '{key}' was not found.") { }
}
public class ValidationException : AppException
{
    public IDictionary<string, string[]> Errors { get; }
    public ValidationException(string field, string message) : base(message)
        => Errors = new Dictionary<string, string[]> { [field] = new[] { message } };
    public ValidationException(IDictionary<string, string[]> errors) : base("One or more fields are invalid.")
        => Errors = errors;
}
public class ConflictException : AppException { public ConflictException(string m) : base(m) { } }
public class ForbiddenException : AppException { public ForbiddenException(string m) : base(m) { } }
public class UnauthorizedException : AppException { public UnauthorizedException(string m) : base(m) { } }
public class QuotaExceededException : AppException { public QuotaExceededException(string m) : base(m) { } }

/// <summary>Collects field errors and throws a single ValidationException.</summary>
public class Validator
{
    private readonly Dictionary<string, List<string>> _errors = new();
    public Validator Require(string field, string? value, int max = 200)
    {
        if (string.IsNullOrWhiteSpace(value)) Add(field, $"{field} is required.");
        else if (value.Length > max) Add(field, $"{field} must be at most {max} characters.");
        return this;
    }
    public Validator Check(bool condition, string field, string message)
    {
        if (!condition) Add(field, message);
        return this;
    }
    public void Add(string field, string message)
    {
        if (!_errors.TryGetValue(field, out var l)) _errors[field] = l = new List<string>();
        l.Add(message);
    }
    public void ThrowIfInvalid()
    {
        if (_errors.Count > 0) throw new ValidationException(_errors.ToDictionary(k => k.Key, v => v.Value.ToArray()));
    }
}

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);
