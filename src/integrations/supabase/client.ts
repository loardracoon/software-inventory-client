import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Anon key only: RLS protects the data. The service role key never reaches the browser.
export const supabase = isSupabaseConfigured ? createClient<Database>(url, anonKey) : null;
