/**
 * asana-oauth — Supabase Edge Function
 *
 * Standard OAuth2 authorization-code flow for Asana.
 * Asana redirects to our callback with ?code=...&state=... — no fragment shim needed.
 *
 * Flow:
 *   1. GET ?action=start&token=<supabase_jwt>
 *      → build Asana authorize URL (state = encoded JWT), redirect.
 *
 *   2. GET /callback?code=<auth_code>&state=<encoded_jwt>
 *      → exchange code for access + refresh tokens (server-side POST)
 *      → verify JWT, upsert connector row
 *      → redirect to datavault://dashboard
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("ASANA_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("ASANA_CLIENT_SECRET")!;

const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/asana-oauth/callback`;
const ASANA_AUTH_URL = "https://app.asana.com/-/oauth_authorize";
const ASANA_TOKEN_URL = "https://app.asana.com/-/oauth_token";

// ── HTML helpers ─────────────────────────────────────────────────────────────

function successPage(displayName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${displayName} Connected — DataVault</title>
  <style>
    body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;text-align:center;gap:16px}
    h1{font-size:1.5rem;font-weight:700;color:#38bdf8}
    p{color:#94a3b8;max-width:360px}
    a{display:inline-block;margin-top:8px;padding:10px 24px;background:#f59e0b;color:#0f172a;border-radius:8px;text-decoration:none;font-weight:600}
  </style>
</head>
<body>
  <h1>${displayName} Connected!</h1>
  <p>Your ${displayName} account has been linked to DataVault. You can close this tab and return to the app.</p>
  <a href="datavault://dashboard">Open DataVault</a>
  <script>setTimeout(function(){ window.location.href = 'datavault://dashboard'; }, 800);</script>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Connection Failed — DataVault</title>
  <style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;text-align:center;gap:12px}h1{color:#f87171}</style>
</head>
<body>
  <h1>Connection Failed</h1>
  <p>${message}</p>
  <p>Close this tab, return to DataVault, and try connecting again.</p>
</body>
</html>`;
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; base-uri 'self'",
    },
  });
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // ── 1. Start ───────────────────────────────────────────────────────────────
  if (action === "start") {
    const jwt = url.searchParams.get("token");
    if (!jwt) return new Response("Missing token", { status: 400 });

    const state = encodeURIComponent(jwt);

    const authUrl = new URL(ASANA_AUTH_URL);
    authUrl.searchParams.set("client_id", CLIENT_ID);
    // redirect_uri must match exactly what is registered in the Asana developer console
    // AND what we send in the token exchange step. Asana rejects a mismatch with 400.
    authUrl.searchParams.set("redirect_uri", CALLBACK_URL);
    authUrl.searchParams.set("response_type", "code");
    // "default" gives full API access — required if no scopes are set in the dev console.
    authUrl.searchParams.set("scope", "default");
    authUrl.searchParams.set("state", state);

    return Response.redirect(authUrl.toString(), 302);
  }

  // ── 2a. Exchange: Electron main process POSTs {code, state} here ──────────
  if (action === "exchange" && req.method === "POST") {
    let code: string;
    let state: string;
    try {
      const form = await req.formData();
      code = form.get("code") as string;
      state = form.get("state") as string;
    } catch {
      return new Response(JSON.stringify({ success: false, error: "Invalid form data." }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    if (!code || !state) {
      return new Response(JSON.stringify({ success: false, error: "Missing code or state." }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    return await exchangeCodeAndSave(code, state);
  }

  // ── 2b. Callback: system-browser flow (Asana sends ?code=...&state=...) ─────
  //   Exchange happens server-side; on success redirect to datavault://dashboard
  //   so the desktop app comes into focus and refreshes its connector list.
  if (url.pathname.endsWith("/callback") && req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) return htmlResponse(errorPage(`Asana returned an error: ${error}`));
    if (!code || !state) return htmlResponse(errorPage("Missing code or state from Asana."), 400);

    const result = await exchangeCodeAndSave(code, state);
    if (result.status === 200) {
      // Redirect the browser tab to the custom protocol — this triggers the
      // Electron deep-link handler which navigates to Dashboard.
      return Response.redirect("datavault://dashboard", 302);
    }
    return htmlResponse(errorPage("Connection failed. Close this tab and try again."), result.status);
  }

  return new Response("Not found", { status: 404 });
});

// ── Shared code exchange + DB save ────────────────────────────────────────────

async function exchangeCodeAndSave(code: string, state: string): Promise<Response> {
  const jsonResp = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  let accessToken: string;
  let refreshToken: string | null = null;
  let expiresIn: number | null = null;
  let workspaceName = "Asana";

  try {
    const tokenResp = await fetch(ASANA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: CALLBACK_URL,
        code,
      }).toString(),
    });

    if (!tokenResp.ok) {
      const body = await tokenResp.text();
      console.error("[asana-oauth] token exchange failed:", body);
      return jsonResp({ success: false, error: "Token exchange with Asana failed." }, 500);
    }

    const tokenData = await tokenResp.json();
    accessToken = tokenData.access_token;
    refreshToken = tokenData.refresh_token ?? null;
    expiresIn = tokenData.expires_in ?? null;
    if (tokenData.data?.email) workspaceName = tokenData.data.email;
    else if (tokenData.data?.name) workspaceName = tokenData.data.name;
    if (!accessToken) return jsonResp({ success: false, error: "No access token from Asana." }, 500);
  } catch (err) {
    console.error("[asana-oauth] token exchange error:", err);
    return jsonResp({ success: false, error: "Network error during token exchange." }, 500);
  }

  const jwt = decodeURIComponent(state);
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: { user }, error: authErr } = await adminClient.auth.getUser(jwt);
  if (authErr || !user) {
    console.error("[asana-oauth] invalid jwt:", authErr?.message);
    return jsonResp({ success: false, error: "Session expired." }, 401);
  }

  const tokenExpiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const { error: dbErr } = await adminClient
    .from("connectors")
    .upsert(
      {
        user_id: user.id,
        type: "asana",
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: tokenExpiresAt,
        workspace_name: workspaceName,
        workspace_id: "",
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,type,workspace_id" },
    );

  if (dbErr) {
    console.error("[asana-oauth] db upsert failed:", dbErr.message);
    return jsonResp({ success: false, error: dbErr.message }, 500);
  }

  return jsonResp({ success: true });
}
