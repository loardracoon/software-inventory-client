import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AuthContext, type AuthContextValue, type Profile } from "./auth-context";
import { signInErrorMessage } from "./sign-in-error";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<{ userId: string; value: Profile | null } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    // Keep this callback synchronous: calling Supabase from inside it can deadlock the auth lock.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!supabase || !userId) return;
    let active = true;
    supabase
      .from("profiles")
      .select("id, email, display_name, role")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setProfile({ userId, value: data });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const sendMagicLink = useCallback(async (email: string, redirectPath: string) => {
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: new URL(redirectPath, window.location.origin).toString() },
    });
    return { error: error ? signInErrorMessage(error.message) : null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const status = !supabase ? "unconfigured" : session === undefined ? "loading" : session ? "signed_in" : "signed_out";
    return {
      status,
      session: session ?? null,
      user: session?.user ?? null,
      profile: profile && profile.userId === userId ? profile.value : null,
      sendMagicLink,
      signOut,
    };
  }, [session, profile, userId, sendMagicLink, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
