import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client for the browser / Electron renderer.
 * Uses anon key so RLS policies protect all data.
 *
 * Priority: VITE_* env vars (set via .env for local dev) →
 *   hardcoded project fallbacks (safe for desktop builds that
 *   have no .env — anon key is public by design, RLS is the gate).
 */

// Anon key is intentionally public — it only enables what RLS allows.
const FALLBACK_URL  = "https://gfiugqsqfuphqvyxojtg.supabase.co";
const FALLBACK_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmaXVncXNxZnVwaHF2eXhvanRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NTAwNjksImV4cCI6MjA4OTIyNjA2OX0.VdqzynoZ_wVjA6chnAvYPINZJQ4BRsQ0mupY0VCS_o8";

/**
 * Supabase project URL — exported so all hooks that call Edge Functions
 * import this instead of repeating import.meta.env lookups.
 */
export const SUPABASE_URL: string =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? FALLBACK_URL;

const supabaseAnonKey: string =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? FALLBACK_ANON;

export const supabase = createClient(SUPABASE_URL, supabaseAnonKey);

/** Check if Supabase is configured (anon key present). */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && supabaseAnonKey);
}
