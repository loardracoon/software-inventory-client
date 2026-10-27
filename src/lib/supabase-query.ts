import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// The Supabase client, or a clear error when the app is not configured.
export function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

// POST to an Edge Function; a non-2xx answer becomes an Error with the function's { error } message.
export async function invokeFunction<T>(name: string, body: object = {}): Promise<T> {
  const { data, error } = await db().functions.invoke<T>(name, { method: "POST", body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Request failed (HTTP ${error.context.status})`);
    }
    throw new Error(error.message);
  }
  return data as T;
}

export function orThrow<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
