/**
 * Notion OAuth — start + callback (Deno Edge Function).
 *
 * Secrets to set in Supabase Dashboard → Edge Functions → Secrets:
 *   NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, NOTION_REDIRECT_URI,
 *   SERVICE_ROLE_KEY (your service_role key — UI forbids SUPABASE_* secret names),
 *   FRONTEND_URL
 * Supabase injects SUPABASE_URL automatically — do not add it as a custom secret.
 *
 * Flow:
 *   1) Frontend calls ?action=start with Authorization: Bearer <supabase_jwt>
 *   2) Function base64-encodes the JWT as `state` and redirects to Notion.
 *   3) Notion redirects back with ?code=&state=
 *   4) Function verifies state (jwt), exchanges code, upserts public.connectors.
 *   5) Redirects browser to FRONTEND_URL/dashboard.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Read required env vars, return null if any are missing. */
function getEnv() {
  const clientId = Deno.env.get("NOTION_CLIENT_ID");
  const clientSecret = Deno.env.get("NOTION_CLIENT_SECRET");
  const redirectUri = Deno.env.get("NOTION_REDIRECT_URI");
  // SUPABASE_URL is auto-injected on deploy. SERVICE_ROLE_KEY is a custom secret (required).
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey =
    Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const frontendUrl = Deno.env.get("FRONTEND_URL") ?? "http://localhost:5173";

  if (!clientId || !clientSecret || !redirectUri || !supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return { clientId, clientSecret, redirectUri, supabaseUrl, serviceRoleKey, frontendUrl };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const env = getEnv();
  if (!env) {
    return new Response(
      JSON.stringify({ error: "Missing env vars", code: "NOT_CONFIGURED" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  // ── Step 1: Start OAuth — redirect browser to Notion ──────────────────────
  if (action === "start") {
    // Accept JWT from Authorization header OR from ?token= query param.
    // The ?token= approach is needed when the browser redirects directly to this URL.
    const authHeader = req.headers.get("Authorization") ?? "";
    const headerJwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    const jwt = headerJwt || (url.searchParams.get("token") ?? "");

    if (!jwt) {
      return new Response(
        JSON.stringify({ error: "Authorization header or ?token= required", code: "NO_JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Encode the JWT as state so we can verify it on callback.
    const state = btoa(jwt);
    const authorize = new URL("https://api.notion.com/v1/oauth/authorize");
    authorize.searchParams.set("client_id", env.clientId);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("owner", "user");
    authorize.searchParams.set("redirect_uri", env.redirectUri);
    authorize.searchParams.set("state", state);

    return Response.redirect(authorize.toString(), 302);
  }

  // ── Step 2: Callback — exchange code, upsert connector ────────────────────
  if (code && stateParam) {
    // Decode state back to JWT and verify with Supabase.
    let jwt: string;
    try {
      jwt = atob(stateParam);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid state parameter", code: "BAD_STATE" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify JWT by fetching the user from Supabase auth.
    const anonClient = createClient(env.supabaseUrl, env.serviceRoleKey);
    const { data: userData, error: authError } = await anonClient.auth.getUser(jwt);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired JWT in state", code: "JWT_INVALID" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userId = userData.user.id;

    // Exchange authorization code for Notion access token.
    const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(`${env.clientId}:${env.clientSecret}`),
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: env.redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      return new Response(
        JSON.stringify({ error: "Notion token exchange failed", details: body.slice(0, 500) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tokenJson = (await tokenRes.json()) as {
      access_token: string;
      workspace_id: string;
      workspace_name?: string;
    };

    // Upsert connector row using service role (bypasses RLS).
    const adminClient = createClient(env.supabaseUrl, env.serviceRoleKey);
    const { error: upsertError } = await adminClient.from("connectors").upsert(
      {
        user_id: userId,
        type: "notion",
        workspace_name: tokenJson.workspace_name ?? null,
        workspace_id: tokenJson.workspace_id,
        access_token: tokenJson.access_token,
        status: "active",
      },
      { onConflict: "user_id,type,workspace_id" },
    );

    if (upsertError) {
      return new Response(
        JSON.stringify({ error: "Failed to save connector", details: upsertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Redirect user back to the dashboard.
    return Response.redirect(`${env.frontendUrl}/dashboard`, 302);
  }

  return new Response(
    JSON.stringify({ error: "Use ?action=start to begin OAuth or complete redirect with ?code=", code: "BAD_REQUEST" }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
