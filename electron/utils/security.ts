const isDev = process.env.NODE_ENV === "development";

const SUPABASE_HOST = "https://gfiugqsqfuphqvyxojtg.supabase.co";
const SUPABASE_WSS = "wss://gfiugqsqfuphqvyxojtg.supabase.co";
const SUPABASE_WSS_WILDCARD = "wss://*.supabase.co";

export function buildCSP(): string {
  const supabaseSrcs = `${SUPABASE_HOST} ${SUPABASE_WSS} ${SUPABASE_WSS_WILDCARD}`;

  if (isDev) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      `connect-src 'self' http://localhost:8080 ws://localhost:8080 ${supabaseSrcs}`,
      "object-src 'none'",
    ].join("; ");
  }

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    `connect-src 'self' ${supabaseSrcs}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
