import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when the app was built with Supabase credentials. */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

/**
 * Lazy Supabase client — only created when credentials are present.
 * The desktop app works fully offline/locally without them.
 */
let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!_client) {
    _client = createClient(supabaseUrl!, supabaseAnonKey!);
  }
  return _client;
}

/**
 * Direct client export for code that imports `supabase` directly.
 * Returns a real client if configured, otherwise a no-op proxy that
 * won't crash the app — it just returns empty data.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseClient();
    if (client) return (client as any)[prop];
    // Return a chainable no-op so the app doesn't crash without credentials
    const noop: any = () => noop;
    noop.then = () => Promise.resolve({ data: null, error: new Error("Supabase not configured") });
    return noop;
  },
});
