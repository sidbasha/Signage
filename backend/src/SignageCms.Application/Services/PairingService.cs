using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using SignageCms.Application.Common;
using SignageCms.Domain.Entities;
using SignageCms.Domain.Enums;

namespace SignageCms.Application.Services;

public record CreatePairingRequest(string DeviceType, string? HardwareId, string? Resolution, string? AppVersion, string? OsVersion);
public record PairingCreatedDto(Guid PairingId, string Code, string PollSecret, DateTime ExpiresAt, int PollIntervalSeconds);
public record PairingStatusDto(string Status, Guid? DeviceId, string? DeviceKey);

/// <summary>Anonymous endpoints used by an unpaired player to obtain a pairing code and then its device key.</summary>
public class PairingService
{
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(15);
    private readonly IAppDbContext _db; private readonly IClock _clock; private readonly ICurrentUser _caller;
    public PairingService(IAppDbContext db, IClock clock, ICurrentUser caller) { _db = db; _clock = clock; _caller = caller; }

    public async Task<PairingCreatedDto> CreateAsync(CreatePairingRequest r, CancellationToken ct)
    {
        if (!Enum.TryParse<DeviceType>(r.DeviceType, true, out var type)) throw new ValidationException("deviceType", "Unknown device type.");
        var now = _clock.UtcNow;
        await _db.PairingRequests.Where(p => p.Status == PairingStatus.Pending && p.ExpiresAt < now)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.Status, PairingStatus.Expired), ct);

        string code;
        do code = new string(Enumerable.Range(0, 6).Select(_ => Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)]).ToArray());
        while (await _db.PairingRequests.AnyAsync(p => p.Code == code && p.Status == PairingStatus.Pending, ct));

        var secret = Crypto.RandomToken(32);
        var req = new PairingRequest
        {
            Code = code, PollSecretHash = Crypto.Sha256(secret), DeviceType = type, HardwareId = Trim(r.HardwareId, 200), Resolution = Trim(r.Resolution, 40),
            AppVersion = Trim(r.AppVersion, 40), OsVersion = Trim(r.OsVersion, 200), IpAddress = _caller.IpAddress, ExpiresAt = now.Add(CodeLifetime),
        };
        _db.PairingRequests.Add(req);
        await _db.SaveChangesAsync(ct);
        return new(req.Id, code, secret, req.ExpiresAt, 3);
    }

    public async Task<PairingStatusDto> StatusAsync(Guid pairingId, string pollSecret, CancellationToken ct)
    {
        var req = await _db.PairingRequests.FirstOrDefaultAsync(p => p.Id == pairingId, ct);
        if (req is null || !Crypto.FixedEquals(req.PollSecretHash, Crypto.Sha256(pollSecret ?? ""))) throw new NotFoundException("Pairing request");
        if (req.Status == PairingStatus.Pending && req.ExpiresAt <= _clock.UtcNow) { req.Status = PairingStatus.Expired; await _db.SaveChangesAsync(ct); }
        if (req.Status == PairingStatus.Paired && req.PendingDeviceKey != null)
        {
            var key = req.PendingDeviceKey;
            req.PendingDeviceKey = null; // hand the key over exactly once
            await _db.SaveChangesAsync(ct);
            return new("Paired", req.DeviceId, key);
        }
        return new(req.Status.ToString(), req.Status == PairingStatus.Paired ? req.DeviceId : null, null);
    }

    private static string? Trim(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];
}
