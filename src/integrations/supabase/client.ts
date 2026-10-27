import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// Runtime config first (/env.js, written by the production container at start, so one image serves any
// host), then the build-time values (.env.local in development).
const runtime = (globalThis as { __ENV__?: { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string } }).__ENV__ ?? {};
const url = runtime.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const anonKey = runtime.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Anon key only: RLS protects the data. The service role key never reaches the browser.
export const supabase = isSupabaseConfigured ? createClient<Database>(url, anonKey) : null;
