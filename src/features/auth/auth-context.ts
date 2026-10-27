import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type Profile = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "email" | "display_name" | "role">;

export type AuthStatus = "loading" | "signed_out" | "signed_in" | "unconfigured";

export type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  sendMagicLink: (email: string, redirectPath: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
