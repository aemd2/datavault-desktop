import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client for the browser.
 * Uses anon key so we can enforce Row Level Security (RLS) in Supabase.
 * Required env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 */
/**
 * Supabase project URL — used by all hooks that call Edge Functions.
 * Exported so hooks import this instead of repeating import.meta.env lookups.
 */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? "";

const supabaseUrl = SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase env missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env for waitlist to work."
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");

/** Check if Supabase is configured (so we can show a fallback or error in the form). */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
