namespace SignageCms.Application.Common;

public static class Permissions
{
    public const string DashboardView = "dashboard.view";
    public const string OrganizationManage = "organization.manage";
    public const string UsersView = "users.view";
    public const string UsersManage = "users.manage";
    public const string RolesManage = "roles.manage";
    public const string LocationsView = "locations.view";
    public const string LocationsManage = "locations.manage";
    public const string DevicesView = "devices.view";
    public const string DevicesManage = "devices.manage";
    public const string DevicesPair = "devices.pair";
    public const string DevicesCommand = "devices.command";
    public const string GroupsManage = "groups.manage";
    public const string MediaView = "media.view";
    public const string MediaManage = "media.manage";
    public const string PlaylistsView = "playlists.view";
    public const string PlaylistsManage = "playlists.manage";
    public const string LayoutsView = "layouts.view";
    public const string LayoutsManage = "layouts.manage";
    public const string SchedulesView = "schedules.view";
    public const string SchedulesManage = "schedules.manage";
    public const string AuditView = "audit.view";
    public const string SubscriptionView = "subscription.view";
    public const string SubscriptionManage = "subscription.manage";

    public static readonly (string Code, string Group, string Description)[] All =
    {
        (DashboardView, "General", "See the dashboard"),
        (OrganizationManage, "General", "Edit organization settings"),
        (UsersView, "People", "See users"),
        (UsersManage, "People", "Invite, edit and deactivate users"),
        (RolesManage, "People", "Create and edit roles"),
        (LocationsView, "Screens", "See locations"),
        (LocationsManage, "Screens", "Create and edit locations"),
        (DevicesView, "Screens", "See devices and their status"),
        (DevicesManage, "Screens", "Edit and remove devices"),
        (DevicesPair, "Screens", "Pair new devices"),
        (DevicesCommand, "Screens", "Send commands to devices"),
        (GroupsManage, "Screens", "Create and edit device groups"),
        (MediaView, "Content", "See the media library"),
        (MediaManage, "Content", "Upload and delete media"),
        (PlaylistsView, "Content", "See playlists"),
        (PlaylistsManage, "Content", "Create and edit playlists"),
        (LayoutsView, "Content", "See layouts and templates"),
        (LayoutsManage, "Content", "Create and edit layouts"),
        (SchedulesView, "Content", "See schedules"),
        (SchedulesManage, "Content", "Create and edit schedules"),
        (AuditView, "Administration", "Read the audit log"),
        (SubscriptionView, "Administration", "See plan and usage"),
        (SubscriptionManage, "Administration", "Change the plan"),
    };

    public static IEnumerable<string> Views => All.Select(p => p.Code).Where(c => c.EndsWith(".view"));

    /// <summary>Roles created for every new organization.</summary>
    public static readonly (string Name, string Description, string[] Permissions)[] SystemRoles =
    {
        ("Owner", "Full access, including billing", All.Select(p => p.Code).ToArray()),
        ("Admin", "Full access except changing the plan",
            All.Select(p => p.Code).Where(c => c != SubscriptionManage).ToArray()),
        ("Editor", "Manages content and schedules",
            Views.Concat(new[] { MediaManage, PlaylistsManage, LayoutsManage, SchedulesManage, DevicesCommand })
                 .Where(c => c != AuditView).ToArray()),
        ("Viewer", "Read-only access", Views.Where(c => c != AuditView).ToArray()),
    };
}
