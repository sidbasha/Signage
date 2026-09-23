namespace SignageCms.Domain.Enums;

/// <summary>Stored as text so new device types can be added without data migration.</summary>
public enum DeviceType { AndroidTv, AndroidTablet, WebPlayer, Other }

public enum DeviceStatus { Offline, Online }

public enum Orientation { Landscape, Portrait }

public enum MediaType { Image, Video, Web }

public enum PairingStatus { Pending, Paired, Expired }

public enum SubscriptionPlan { Free, Pro, Enterprise }

public enum SubscriptionStatus { Active, PastDue, Cancelled }

public enum NotificationSeverity { Info, Success, Warning, Error }
