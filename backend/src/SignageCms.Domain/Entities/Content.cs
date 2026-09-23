using SignageCms.Domain.Common;
using SignageCms.Domain.Enums;

namespace SignageCms.Domain.Entities;

public class MediaAsset : TenantEntity
{
    public string Name { get; set; } = "";
    public MediaType Type { get; set; }
    public string? MimeType { get; set; }
    /// <summary>Storage key relative to the storage root; null for web content.</summary>
    public string? StorageKey { get; set; }
    public string? OriginalFileName { get; set; }
    public long SizeBytes { get; set; }
    public string? Sha256 { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    /// <summary>Natural duration for video; default display time for images/web.</summary>
    public int DurationSeconds { get; set; } = 10;
    public string? Url { get; set; }
    public string? Tags { get; set; }
    public Guid? UploadedById { get; set; }
}

public class Playlist : TenantEntity
{
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public bool Shuffle { get; set; }
    public ICollection<PlaylistItem> Items { get; set; } = new List<PlaylistItem>();
}

public class PlaylistItem : BaseEntity
{
    public Guid PlaylistId { get; set; }
    public Playlist? Playlist { get; set; }
    public Guid MediaAssetId { get; set; }
    public MediaAsset? MediaAsset { get; set; }
    public int SortOrder { get; set; }
    /// <summary>Override of display time; null uses the asset's duration.</summary>
    public int? DurationSeconds { get; set; }
    public string Transition { get; set; } = "fade";
}

/// <summary>
/// A screen layout: a canvas divided into zones. Templates are organization-owned layouts flagged IsTemplate
/// (seeded per organization) that can be cloned into new layouts.
/// </summary>
public class Layout : TenantEntity
{
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public Orientation Orientation { get; set; } = Orientation.Landscape;
    public int Width { get; set; } = 1920;
    public int Height { get; set; } = 1080;
    public string BackgroundColor { get; set; } = "#000000";
    public bool IsTemplate { get; set; }
    public ICollection<LayoutZone> Zones { get; set; } = new List<LayoutZone>();
}

/// <summary>Zone geometry is expressed in percent of the canvas, so layouts scale to any resolution.</summary>
public class LayoutZone : BaseEntity
{
    public Guid LayoutId { get; set; }
    public Layout? Layout { get; set; }
    public string Name { get; set; } = "";
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
    public int ZIndex { get; set; }
    public Guid? PlaylistId { get; set; }
    public Playlist? Playlist { get; set; }
}

/// <summary>
/// Schedules content (a layout or a single full-screen playlist) onto devices/groups for a date range,
/// daily time window and days of week. Higher priority wins when schedules overlap.
/// </summary>
public class Schedule : TenantEntity
{
    public string Name { get; set; } = "";
    public Guid? LayoutId { get; set; }
    public Layout? Layout { get; set; }
    public Guid? PlaylistId { get; set; }
    public Playlist? Playlist { get; set; }
    public int Priority { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public TimeOnly? StartTime { get; set; }
    public TimeOnly? EndTime { get; set; }
    /// <summary>Bitmask, Sunday = 1 … Saturday = 64. 127 = every day.</summary>
    public int DaysOfWeek { get; set; } = 127;
    public bool IsActive { get; set; } = true;
    public ICollection<ScheduleTarget> Targets { get; set; } = new List<ScheduleTarget>();
}

public class ScheduleTarget : BaseEntity
{
    public Guid ScheduleId { get; set; }
    public Schedule? Schedule { get; set; }
    public Guid? DeviceId { get; set; }
    public Device? Device { get; set; }
    public Guid? DeviceGroupId { get; set; }
    public DeviceGroup? DeviceGroup { get; set; }
}
