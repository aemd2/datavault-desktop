/**
 * google-sheets-oauth — Supabase Edge Function
 *
 * Standard OAuth2 authorization-code flow for Google (Sheets + Drive discovery).
 * Matches desktop `startGoogleSheetsOAuth` → `openSupabaseOAuthInBrowser({ kind: "google-sheets" })`.
 *
 * `access_type=offline` + `prompt=consent` encourage a refresh_token on first link.
 *
 * Flow:
 *   1. GET ?action=start&token=<supabase_jwt>
 *      → state = URL-encoded JWT (same pattern as Todoist / Asana)
 *      → redirect to accounts.google.com/o/oauth2/v2/auth
 *   2. GET /callback?code=...&state=...
 *      → POST oauth2.googleapis.com/token, upsert connector, redirect datavault://dashboard
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/google-sheets-oauth/callback`;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Sheets read/write + Drive listing + email for `workspace_name`
 * (see `datavault-desktop/docs/CONNECTOR_SETUP.md`).
 */
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

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

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "start") {
    const jwt = url.searchParams.get("token");
    if (!jwt) return new Response("Missing token", { status: 400 });

    const state = encodeURIComponent(jwt);
    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", CALLBACK_URL);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("access_type", "offline");
    // Re-show consent so Google returns refresh_token when the user already granted once.
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("include_granted_scopes", "true");

    return Response.redirect(authUrl.toString(), 302);
  }

  if (action === "exchange" && req.method === "POST") {
    let code: string;
    let state: string;
    try {
      const form = await req.formData();
      code = form.get("code") as string;
      state = form.get("state") as string;
    } catch {
      return new Response(JSON.stringify({ success: false, error: "Invalid form data." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!code || !state) {
      return new Response(JSON.stringify({ success: false, error: "Missing code or state." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    return await exchangeCodeAndSave(code, state);
  }

  if (url.pathname.endsWith("/callback") && req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    if (err) return htmlResponse(errorPage(`Google returned an error: ${err}`));
    if (!code || !state) return htmlResponse(errorPage("Missing code or state from Google."), 400);

    const result = await exchangeCodeAndSave(code, state);
    if (result.status === 200) {
      return Response.redirect("datavault://dashboard", 302);
    }
    return htmlResponse(errorPage("Connection failed. Close this tab and try again."), result.status);
  }

  return new Response("Not found", { status: 404 });
});

async function exchangeCodeAndSave(code: string, state: string): Promise<Response> {
  const jsonResp = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  let accessToken: string;
  let refreshToken: string | null = null;
  let expiresIn: number | null = null;

  try {
    const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
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
      console.error("[google-sheets-oauth] token exchange failed:", body);
      return jsonResp({ success: false, error: `Google rejected the token exchange: ${body}` }, 500);
    }

    const tokenData = await tokenResp.json() as Record<string, unknown>;
    accessToken = String(tokenData.access_token ?? "");
    refreshToken = tokenData.refresh_token != null ? String(tokenData.refresh_token) : null;
    expiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : null;
    if (!accessToken) return jsonResp({ success: false, error: "No access token from Google." }, 500);
  } catch (err) {
    console.error("[google-sheets-oauth] token exchange error:", err);
    return jsonResp({ success: false, error: "Network error during token exchange." }, 500);
  }

  const jwt = decodeURIComponent(state);
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: { user }, error: authErr } = await adminClient.auth.getUser(jwt);
  if (authErr || !user) {
    console.error("[google-sheets-oauth] invalid jwt:", authErr?.message);
    return jsonResp({ success: false, error: "Session expired." }, 401);
  }

  let workspaceName = "Google Sheets";
  try {
    const ui = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (ui.ok) {
      const profile = await ui.json() as { email?: string; name?: string };
      if (profile.email) workspaceName = profile.email;
      else if (profile.name) workspaceName = profile.name;
    }
  } catch { /* optional */ }

  const tokenExpiresAt = expiresIn != null
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const { error: dbErr } = await adminClient
    .from("connectors")
    .upsert(
      {
        user_id: user.id,
        type: "google-sheets",
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
    console.error("[google-sheets-oauth] db upsert failed:", dbErr.message);
    return jsonResp({ success: false, error: dbErr.message }, 500);
  }

  return jsonResp({ success: true });
}
