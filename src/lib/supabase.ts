import { createClient } from "@supabase/supabase-js";

// Public anon key — safe to ship in the app bundle.
// These are the same credentials used by the DataVault website.
// RLS (Row Level Security) in Supabase ensures users can only access their own data.
const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  "https://gfiugqsqfuphqvyxojtg.supabase.co";

const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmaXVncXNxZnVwaHF2eXhvanRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NTAwNjksImV4cCI6MjA4OTIyNjA2OX0.VdqzynoZ_wVjA6chnAvYPINZJQ4BRsQ0mupY0VCS_o8";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function isSupabaseConfigured(): boolean {
  return true;
}
