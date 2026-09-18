import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type User } from "../lib/api.js";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (input: { username: string; password: string; email?: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const res = await api.get<{ user: User }>("/api/auth/me");
        return res.user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });

  const refresh = () => qc.invalidateQueries();

  const value: AuthCtx = {
    user: data ?? null,
    loading: isLoading,
    login: async (username, password) => {
      await api.post("/api/auth/login", { username, password });
      await refresh();
    },
    register: async (input) => {
      await api.post("/api/auth/register", input);
      await refresh();
    },
    logout: async () => {
      // End the server session (ignore transient errors — we still log out locally).
      try {
        await api.post("/api/auth/logout");
      } catch {
        /* ignore */
      }
      // Drop every other cached query, then set the current user to null synchronously so the
      // gate re-renders to the landing page immediately (no dependence on a refetch).
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      qc.setQueryData(["me"], null);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
