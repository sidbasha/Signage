using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using SignageCms.Application.Common;

namespace SignageCms.Infrastructure.Storage;

public class StorageOptions { public string RootPath { get; set; } = "storage"; }

/// <summary>Stores media on local disk. Swap for a blob-storage implementation of <see cref="IFileStorage"/> in multi-node deployments.</summary>
public class LocalFileStorage : IFileStorage
{
    private readonly string _root;
    public LocalFileStorage(IOptions<StorageOptions> o)
    {
        _root = Path.GetFullPath(o.Value.RootPath);
        Directory.CreateDirectory(_root);
    }

    public string GetPhysicalPath(string key)
    {
        var full = Path.GetFullPath(Path.Combine(_root, key));
        if (!full.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal)) throw new InvalidOperationException("Invalid storage key.");
        return full;
    }

    public async Task<StoredFile> SaveAsync(Stream content, string key, CancellationToken ct)
    {
        var path = GetPhysicalPath(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".uploading";
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long size = 0;
        try
        {
            await using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                var buffer = new byte[81920];
                int read;
                while ((read = await content.ReadAsync(buffer, ct)) > 0)
                {
                    sha.AppendData(buffer, 0, read);
                    await fs.WriteAsync(buffer.AsMemory(0, read), ct);
                    size += read;
                }
            }
            File.Move(tmp, path, overwrite: true);
        }
        catch { if (File.Exists(tmp)) File.Delete(tmp); throw; }
        return new StoredFile(key, size, Convert.ToHexString(sha.GetHashAndReset()).ToLowerInvariant());
    }

    public Task DeleteAsync(string key)
    {
        var path = GetPhysicalPath(key);
        if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }
}
