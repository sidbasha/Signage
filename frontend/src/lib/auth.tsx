import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, hasSession, onSessionChange, setSession } from "./api";
import type { AuthResponse, Me } from "./types";

interface AuthCtx {
  user: Me | null; loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: { organizationName: string; fullName: string; email: string; password: string; timeZone?: string }): Promise<void>;
  logout(): Promise<void>;
  can(permission: string): boolean;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(hasSession());
  const qc = useQueryClient();

  useEffect(() => {
    if (hasSession()) api<Me>("/api/auth/me").then(setUser).catch(() => setSession(null)).finally(() => setLoading(false));
    const off = onSessionChange(() => { if (!hasSession()) { setUser(null); qc.clear(); } });
    return () => { off(); };
  }, [qc]);

  const accept = (r: AuthResponse) => { setSession(r); setUser(r.user); };
  const value: AuthCtx = {
    user, loading,
    login: async (email, password) => accept(await api<AuthResponse>("/api/auth/login", { method: "POST", json: { email, password } })),
    register: async (input) => accept(await api<AuthResponse>("/api/auth/register", { method: "POST", json: input })),
    logout: async () => {
      const raw = localStorage.getItem("signage.session");
      const refreshToken = raw ? JSON.parse(raw).refreshToken : "";
      await api("/api/auth/logout", { method: "POST", json: { refreshToken } }).catch(() => {});
      setSession(null);
    },
    can: (p) => !!user?.permissions.includes(p),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
