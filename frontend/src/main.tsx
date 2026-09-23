import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import { ApiError } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { AppShell } from "./components/AppShell";
import { EmptyState, Loading } from "./components/common";
import { LoginPage, RegisterPage } from "./pages/AuthPages";
import { DashboardPage } from "./pages/DashboardPage";
import { DevicesPage } from "./pages/DevicesPage";
import { DeviceDetailPage } from "./pages/DeviceDetailPage";
import { GroupsPage, LocationsPage } from "./pages/GroupsLocationsPages";
import { MediaPage } from "./pages/MediaPage";
import { PlaylistEditorPage, PlaylistsPage } from "./pages/PlaylistsPages";
import { LayoutEditorPage, LayoutsPage } from "./pages/LayoutsPages";
import { SchedulesPage } from "./pages/SchedulesPage";
import { AuditPage, NotificationsPage, RolesPage, SettingsPage, SubscriptionPage, UsersPage } from "./pages/AdminPages";

// The player is its own bundle: screens never download the admin UI.
const PlayerApp = lazy(() => import("./player/PlayerApp"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2 },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Signing in…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

function Perm({ p, children }: { p: string; children: ReactNode }) {
  const { can } = useAuth();
  return can(p) ? <>{children}</> : <EmptyState title="You don't have access to this page">Ask an owner or admin to give your role the “{p}” permission.</EmptyState>;
}

function AdminApp() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Perm p="dashboard.view"><DashboardPage /></Perm>} />
          <Route path="devices" element={<Perm p="devices.view"><DevicesPage /></Perm>} />
          <Route path="devices/:id" element={<Perm p="devices.view"><DeviceDetailPage /></Perm>} />
          <Route path="groups" element={<Perm p="devices.view"><GroupsPage /></Perm>} />
          <Route path="locations" element={<Perm p="locations.view"><LocationsPage /></Perm>} />
          <Route path="media" element={<Perm p="media.view"><MediaPage /></Perm>} />
          <Route path="playlists" element={<Perm p="playlists.view"><PlaylistsPage /></Perm>} />
          <Route path="playlists/:id" element={<Perm p="playlists.view"><PlaylistEditorPage /></Perm>} />
          <Route path="layouts" element={<Perm p="layouts.view"><LayoutsPage /></Perm>} />
          <Route path="layouts/:id" element={<Perm p="layouts.view"><LayoutEditorPage /></Perm>} />
          <Route path="schedules" element={<Perm p="schedules.view"><SchedulesPage /></Perm>} />
          <Route path="users" element={<Perm p="users.view"><UsersPage /></Perm>} />
          <Route path="roles" element={<Perm p="users.view"><RolesPage /></Perm>} />
          <Route path="audit" element={<Perm p="audit.view"><AuditPage /></Perm>} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="subscription" element={<Perm p="subscription.view"><SubscriptionPage /></Perm>} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<EmptyState title="Page not found" />} />
        </Route>
      </Routes>
      <Toaster position="bottom-right" richColors closeButton />
    </AuthProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/player/*" element={<Suspense fallback={<div className="h-screen bg-black" />}><PlayerApp /></Suspense>} />
          <Route path="/*" element={<AdminApp />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
