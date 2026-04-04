const isDev = process.env.NODE_ENV === "development";

// Supabase project — must match VITE_SUPABASE_URL in .env
const SUPABASE_HOST = "https://gfiugqsqfuphqvyxojtg.supabase.co";
const SUPABASE_WSS = "wss://gfiugqsqfuphqvyxojtg.supabase.co";
// Supabase Realtime uses a wildcard subdomain for websockets
const SUPABASE_WSS_WILDCARD = "wss://*.supabase.co";

/**
 * Returns the Content-Security-Policy string.
 * Allows Supabase for auth, API, Realtime, and Edge Functions.
 * Development also allows the Vite dev server and HMR WebSocket.
 */
export function buildCSP(): string {
  const supabaseSrcs = `${SUPABASE_HOST} ${SUPABASE_WSS} ${SUPABASE_WSS_WILDCARD}`;

  if (isDev) {
    // Development: Vite dev server uses inline scripts, ES modules, eval, and
    // WebSocket for HMR — CSP must be permissive or Vite won't load at all.
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      `connect-src 'self' http://localhost:8080 ws://localhost:8080 ${supabaseSrcs}`,
      "object-src 'none'",
    ].join("; ");
  }

  // Production: locked down — only Supabase network access
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseSrcs}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
